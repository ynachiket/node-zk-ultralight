/*
Copyright 2013 Rackspace Hosting, Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

var async = require('async');

var zkultra = require('../lib/ultralight');

var URLS = ['127.0.0.1:2181'];
var BAD_URLS = ['127.0.0.1:666'];


exports['tearDown'] = function(test, assert) {
  zkultra.shutdown();
  test.finish();
};


exports['test_lock_unlock'] = function(test, assert) {
  var cxn = zkultra.getCxn(URLS);
  async.series([
    cxn.lock.bind(cxn, '/plumber/wrench', 'grrr'),
    cxn.unlock.bind(cxn, '/plumber/wrench')
  ], function(err, result) {
    assert.ifError(err);
    test.finish();
  });
};


exports['test_timeout_on_no_cxn'] = function(test, assert) {
  var cxn = zkultra.getCxn(BAD_URLS, 500);
  cxn.lock('/some-lock', 'not happening', function(err) {
    assert.ok(err);
    assert.ok(err instanceof Error);
    test.finish();
  });
};


exports['test_create_no_slash_in_path'] = function(test, assert) {
  var cxn = zkultra.getCxn(URLS);
  cxn.lock('INVALID_PATH', 'ponies', function(err) {
    assert.ok(err);
    test.finish();
  });
};


exports['test_same_client_acquires_lock_twice_with_unlock'] = function(test, assert) {
  var
    start = new Date().getTime();
    cxn = zkultra.getCxn(URLS);

  async.auto({
    'take one': cxn.lock.bind(cxn, '/apple/tree', 'apples'),
    'take one sleep': ['take one', function(callback) {
      setTimeout(callback, 500);
    }],
    'unlock one': ['take one sleep', cxn.unlock.bind(cxn, '/apple/tree')],
    'take two': ['take one', function(callback) {
      cxn.lock('/apple/tree', 'apples', function(err) {
        assert.ok(new Date().getTime() - start >= 500);
        callback();
      });
    }]
  }, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports['test_simple_lock_contention'] = function(test, assert) {
  var cxn = zkultra.getCxn(URLS);
  async.auto({
    'take one': cxn.lock.bind(cxn, '/plum/tree', 'plums'),
    'one locked': ['take one', function(callback) { callback(null, true); }],
    'take one sleep': ['take one', function(callback) {
      setTimeout(callback, 500);
    }],
    'take two': ['one locked', function(callback, result) {
      cxn.lock('/plum/tree', 'birds', function(err) {
        assert.ifError(err);
        assert.ok(result['one locked'] === false);
        callback();
      });
    }],
    'unlock one': ['take one sleep', function(callback, result) {
      result['one locked'] = false;
      cxn.unlock('/plum/tree', callback);
    }]
  }, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports['test_slightly_less_simple_lock_contention'] = function(test, assert) {
  var cxn = zkultra.getCxn(URLS);
  async.auto({
    'take one': cxn.lock.bind(cxn, '/dogwood/tree', 'dogs'),
    'one locked': ['take one', function(callback) { callback(null, true); }],
    'take one sleep': ['take one', function(callback) {
      setTimeout(callback, 500);
    }],
    'take two': ['one locked', function(callback, result) {
      cxn.lock('/dogwood/tree', 'birds', function(err) {
        assert.ifError(err);
        assert.ok(result['one locked'] === false);
        callback();
      });
    }],
    'two locked': ['take two', function(callback) { callback(null, true); }],
    'take three': ['two locked', function(callback, result) {
      cxn.lock('/dogwood/tree', 'sunshine', function(err) {
        assert.ifError(err);
        assert.ok(result['two locked'] === false);
        callback();
      });
    }],
    'unlock one': ['take one sleep', function(callback, result) {
      result['one locked'] = false;
      cxn.unlock('/dogwood/tree', callback);
    }],
    'unlock two': ['unlock one', 'two locked', function(callback, result) {
      result['two locked'] = false;
      cxn.unlock('/dogwood/tree', callback);
    }]
  }, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports['test_concurrent_locks_with_one_client'] = function(test, assert) {
  var cxn = zkultra.getCxn(URLS);
  async.auto({
    'lock a': cxn.lock.bind(cxn, '/dog/brain', 'woof'),
    'lock b': ['lock a', cxn.lock.bind(cxn, '/cat/brain', 'meow')],
    'unlock a': ['lock b', cxn.unlock.bind(cxn, '/dog/brain')],
    'unlock b': ['unlock a', cxn.unlock.bind(cxn, '/cat/brain')]
  }, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


exports['test_close_unlocks_so_others_can_lock'] = function(test, assert) {
  var cxn = zkultra.getCxn(URLS);
  async.auto({
    'lock': cxn.lock.bind(cxn, '/111/Minna', 'great coffee'),
    'shutdown': ['lock', zkultra.shutdown],
    'new client': ['shutdown', function(callback) {
      callback(null, zkultra.getCxn(URLS));
    }],
    'lock again': ['new client', function(callback, results) {
      results['new client'].lock('/111/Minna', 'still great coffee', callback);
    }]
  }, function(err) {
    assert.ifError(err);
    test.finish();
  });
};


