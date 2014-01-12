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

var test = require('tape');

var async = require('async');

var zkultra = require('../lib/ultralight');

var URLS = ['127.0.0.1:2181'];
var BAD_URLS = ['127.0.0.1:666'];


test('lock and unlock', function(t) {
  var cxn = zkultra.getCxn(URLS);
  async.series([
    cxn.lock.bind(cxn, '/plumber/wrench', 'grrr'),
    cxn.unlock.bind(cxn, '/plumber/wrench')
  ], function(err, result) {
    t.ifError(err, "No error in lock and unlock");
    t.end();
  });
});

test('timeout on no connection', function(t) {
  var cxn = zkultra.getCxn(BAD_URLS, 500);
  cxn.lock('/some-lock', 'not happening', function(err) {
    t.ok(err, "Correctly received error on timeout");
    t.ok(err instanceof Error);
    t.end();
  });
});

test('create with invalid path (missing a slash)', function(t) {
  var cxn = zkultra.getCxn(URLS);
  cxn.lock('INVALID_PATH', 'ponies', function(err) {
    t.ok(err, "Invalid path receives an error");
    t.end();
  });
});

test('same client acquires lock twice with unlock', function(t) {
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
        t.ok(new Date().getTime() - start >= 500, "The lock callback does not fire until after the first lock is unlocked");
        callback();
      });
    }]
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});

test('simple lock contention', function(t) {
  var cxn = zkultra.getCxn(URLS);
  async.auto({
    'take one': cxn.lock.bind(cxn, '/plum/tree', 'plums'),
    'one locked': ['take one', function(callback) { callback(null, true); }],
    'take one sleep': ['take one', function(callback) {
      setTimeout(callback, 500);
    }],
    'take two': ['one locked', function(callback, result) {
      cxn.lock('/plum/tree', 'birds', function(err) {
        t.ifError(err);
        t.ok(result['one locked'] === false);
        callback();
      });
    }],
    'unlock one': ['take one sleep', function(callback, result) {
      result['one locked'] = false;
      cxn.unlock('/plum/tree', callback);
    }]
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});

test('slightly less simple lock contention', function(t) {
  var cxn = zkultra.getCxn(URLS);
  async.auto({
    'take one': cxn.lock.bind(cxn, '/dogwood/tree', 'dogs'),
    'one locked': ['take one', function(callback) { callback(null, true); }],
    'take one sleep': ['take one', function(callback) {
      setTimeout(callback, 500);
    }],
    'take two': ['one locked', function(callback, result) {
      cxn.lock('/dogwood/tree', 'birds', function(err) {
        t.ifError(err);
        t.ok(result['one locked'] === false);
        callback();
      });
    }],
    'two locked': ['take two', function(callback) { callback(null, true); }],
    'take three': ['two locked', function(callback, result) {
      cxn.lock('/dogwood/tree', 'sunshine', function(err) {
        t.ifError(err);
        t.ok(result['two locked'] === false);
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
    t.ifError(err);
    t.end();
  });
});

test('concurrent locks with one client', function(t) {
  var cxn = zkultra.getCxn(URLS);
  async.auto({
    'lock a': cxn.lock.bind(cxn, '/dog/brain', 'woof'),
    'lock b': ['lock a', cxn.lock.bind(cxn, '/cat/brain', 'meow')],
    'unlock a': ['lock b', cxn.unlock.bind(cxn, '/dog/brain')],
    'unlock b': ['unlock a', cxn.unlock.bind(cxn, '/cat/brain')]
  }, function(err) {
    t.ifError(err);
    t.end();
  });
});

test('close unlocks so others can lock', function(t) {
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
    t.ifError(err);
    t.end();
  });
});

// this test validates we handle a zk server bug correctly
test('get children error', function(t) {
  var cxn = zkultra.getCxn(URLS);

  // Override the ._getChildren function to force it to error when called inside of .lock
  cxn._getChildren = function(path, watch, callback) {
    callback('mocking an incorrect response from zk server');
  };

  cxn.lock('/Stumptown/coffee', 'the best coffee', function(err) {
    t.ok(err);
    t.end();
  });
});

// this needs to be last, tape has no notion of 'cleanup'
test('cleanup', function(t) {
  zkultra.shutdown();
  t.end();
});




