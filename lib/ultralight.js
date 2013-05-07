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

/**
 * @description
 *
 * The `exports` object:
 * - getCxn(zkUrls, cxnTimeout)
 * - shutdown(callback)
 * - ZkError
 *
 * Public methods on ZkCxn:
 * - lock(name, txnId, callback)
 * - unlock(name, callback)
 *
 * Public methods on ZkCxn you probably do not need to call:
 * - onConnection(callback)
 * - close(callback)
 */

/**
 * @example
var zkultra = require('zk-ultralight');
var cxn = zkultra.getCxn(['127.0.0.1:2181']);
function performActionWithLock(callback) {
  async.series([
    cxn.lock.bind(cxn, '/critical/section', 'vroom'),
    performAction,
    cxn.unlock.bind(cxn, '/critical/section')
  ], callback);
}
 */

var util = require('util');
var events = require('events');
var ZK = require('zookeeper').ZooKeeper;
var async = require('async');
var _ = require('underscore');

var log = require('logmagic').local('zk-ultralight');


/**
 * Default connection timeout in ms,
 * passed to node-zookeeper, also used for per-transaction timeouts
 * TODO: consider splitting these two values
 */
var DEFAULT_ZK_CXN_TIMEOUT = 8000;

var cxns = {}; // urls -> ZkCxn


/**
 * @param {Array} zkUrls Array of strings like '127.0.0.1:999' for ZK servers to connect to.
 * @param {Number} cxnTimeout A timeout value used by the native client, the server, and for ZK operation timeouts.
 */
exports.getCxn = function getCxn(zkUrls, cxnTimeout) {
  var
    urls = zkUrls.join(','),
    timeout = cxnTimeout || DEFAULT_ZK_CXN_TIMEOUT,
    cxn = cxns[urls] || new ZkCxn(urls, timeout);

  log.trace1('getCxn');
  cxn._connect(function() {});
  cxns[urls] = cxn;
  return cxn;
};


/**
 * Close all open connections. Call prior to exit.
 * @param {Function} callback A callback called on completion.
 */
exports.shutdown = function shutdown(callback) {
  var toClose = _.values(cxns);
  cxns = {};
  log.trace1('shutdown');
  async.forEach(toClose, function(cxn, callback) {
    cxn.close(callback);
  }, callback);
};


/**
 * A class wrapping a node-zookeeper connection pool.
 *
 * When `this._zk` is constructed, `this._urls` is passed to it
 * as the connection pooling is handled by the native client library.
 * Reconnect on disconnect is handled there too.
 *
 * @constructor
 * @params {String} urls A comma-delimited array of <ZK host:port>s.
 * @params {?Number} timeout A timeout.
 */
function ZkCxn(urls, timeout) {
  this._urls = urls;
  this._zk = null;
  this._stateEmitter = undefined; // created on connect
  this._cxnState = this.cxnStates.CLOSED;
  this._locks = {}; // lockname -> lock node
  this._watching = {}; // node path -> array of Function
  this._timeout = timeout;
  this._sessionId = undefined;
}


/**
 * Locking loosely based on:
 * http://zookeeper.apache.org/doc/trunk/recipes.html#sc_recipes_Locks
 *
 * Doesn't negotiate for locks with children of the lock-path node
 * as then the lock-path node can't be ephemeral.
 *
 * Waits for the lock to become available.
 *
 * @param {String} name The fully-qualified lock path.
 * @param {String} txnId transaction identifier which is written to the lock node.
 * @param {Function} callback A function(error) called on lock acquisition.
 */
ZkCxn.prototype.lock = function(name, txnId, callback) {
  var
    self = this,
    lockname = name.slice(name.lastIndexOf('/') + 1),
    lockpath = name.slice(0, name.lastIndexOf('/') + 1);

  this.onConnection(function(err) {
    if (err) {
      callback(err);
      return;
    }

    log.trace1('ZkCxn.lock');
    // ensure the parent path exists,
    // then negotiate for the child node which is the lock node
    async.auto({
      'path': self._createPath.bind(self, lockpath, txnId, 0),
      'node': ['path', self._create.bind(self, name, txnId, ZK.ZOO_SEQUENCE | ZK.ZOO_EPHEMERAL)],
      'lock': ['node', function negotiateLock(callback, results) {
        var gotLock = false;
        async.until(function() {
          return gotLock;
        }, function(callback) {
          self._getChildren(lockpath, false, function(err, children) {
            var
              position = results.node.slice(lockpath.length + lockname.length),
              nextLowest, matchingChildren, sequenceNumbers;

            // return only children matching this lock
            matchingChildren = children.filter(function(n) { return n.indexOf(lockname) !== -1; });
            // get only the sequence number
            sequenceNumbers = matchingChildren.map(function(n) { return n.slice(lockname.length); });
            sequenceNumbers = sequenceNumbers.sort();

            // see if ours is the lowest
            if (position === sequenceNumbers[0]) {
              // If the pathname created in step 1 has the lowest sequence number suffix,
              // the client has the lock and the client exits the protocol.
              log.trace1f('${name} locked on ${node}', {name: name, node: results.node});
              self._locks[name] = results.node;
              gotLock = true;
              callback();
              return;
            }

            nextLowest = sequenceNumbers[_.indexOf(sequenceNumbers, position, true) - 1];
            if (nextLowest) {
              // turn the sequence number back into a node name
              nextLowest = lockpath + lockname + nextLowest;
              // The client calls exists( ) with the watch flag set on the path
              // in the lock directory with the next lowest sequence number.
              self._exists(nextLowest, true, function(err, exists) {
                if (!exists) {
                  // if exists( ) returns false, go to step 2.
                  callback();
                  return;
                }
                // Otherwise, wait for a notification for the pathname
                // from the previous step before going to step 2.
                self._watch(nextLowest, callback);
                return;
              });
            }
          });
        }, callback);
      }]
    }, callback);
  });
};


/**
 * Unlock the lock <name>.
 * @param {String} name The fully-qualified lock path.
 * @param {Function} callback A callback called upon completion.
 */
ZkCxn.prototype.unlock = function(name, callback) {
  var self = this;
  this.onConnection(function(err) {
    if (err) {
      callback(err);
      return;
    }
    if (!self._locks[name]) {
      callback(new Error("Don't have lock " + name + "!"));
      return;
    }
    log.trace1('ZkCxn.unlock');
    // TODO: still not sure what version should be.
    self._zk.a_delete_(self._locks[name], 0, function(rc, error) {
      if (rc !== ZK.ZOK) {
        callback(error);
        return;
      }
      delete self._locks[name];
      callback(null, name);
    });
  });
};


/**
 * When connected, call this callback. Times out after this._timeout.
 * TODO: Should this really be public?
 * @param {Function} callback A function taking (err).
 */
ZkCxn.prototype.onConnection = function(callback) {
  if (this._cxnState === this.cxnStates.ERROR) {
    var err = new Error("ZooKeeper connection is in ERROR");
    callback(err);
    this._changeState(this.cxnStates.ERROR, err);
    return;
  } else if (this._cxnState === this.cxnStates.CONNECTED) {
    callback();
    return;
  }

  var
    self = this,
    originalCallback = callback,
    timerId = setTimeout(function() {
      callback(new Error("Timed out after "+ self._timeout));
    }, this._timeout);

  log.trace1('ZkCxn.onConnection');
  callback = _.once(function() {
    clearTimeout(timerId);
    // a bound `this` cannot be overridden
    originalCallback.apply(null, arguments);
  });

  if (!this._stateEmitter) {
    this._stateEmitter = new events.EventEmitter();
  }

  this._stateEmitter.on(this.cxnStates.CONNECTED, callback);
  this._stateEmitter.on(this.cxnStates.ERROR, callback);
};


/** An enum of states the connection can be in. */
ZkCxn.prototype.cxnStates = {
  ERROR: 'ERROR',
  CLOSED: 'CLOSED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED'
};


/**
 * @param {String} to The cxnStates value to change to.
 * @param {?Object} data An optional data object (i.e. err) associated with the state change.
 */
ZkCxn.prototype._changeState = function(to, data) {
  log.trace1f('ZkCxn.changeState', {to: to});
  this._cxnState = to;
  if (this._stateEmitter) {
    this._stateEmitter.emit(to, data);
  }
};


/**
 * Calls the callback once a connection is established.
 * If already connected, calls immediately.
 * If in error, calls with error.
 * Creates a new ZK connection pool.
 *
 * @param {Function} callback A callback(err) called when connected.
 */
ZkCxn.prototype._connect = function(callback) {
  var self = this, err;

  log.trace1('ZkCxn._connect');
  callback = _.once(callback);

  if (this._cxnState === this.cxnStates.CONNECTING) {
    this.onConnection(callback);
    return;
  } else if (this._cxnState === this.cxnStates.CONNECTED) {
    callback();
    return;
  } else if (this._zk) {
    // either ERROR or intentionally CLOSED
    err = new Error("Connection is closed!");
    callback(err);
    this._changeState(this.cxnStates.ERROR, err);
    return;
  }

  this._changeState(this.cxnStates.CONNECTING);

  this._zk = new ZK();
  if (!this._stateEmitter) {
    this._stateEmitter = new events.EventEmitter();
  }

  this._zk.on(ZK.on_connected, function(zk_client) {
    log.trace1('on_connected');
    self._sessionId = zk_client.client_id;
    self._changeState(self.cxnStates.CONNECTED);
    callback(null, self.sessionId);
  });

  this._zk.on(ZK.on_connecting, function(zk_client) {
    log.trace1('on_connecting');
    self._changeState(self.cxnStates.CONNECTING);
  });

  this._zk.on(ZK.on_closed, function(zk_client) {
    log.trace1('on_closed');
    self._zk = null;
    self._stateEmitter = undefined;
    if (self._cxnState !== self.cxnStates.CLOSED) {
      // unexpected close, attempt reconnect
      // this logic also exists in zookeeper.c - handle_error()
      // if handle_error's reconnect occurs, our state will be set to CONNECTING
      // TODO: backoff?
      self._changeState(self.cxnStates.ERROR, new Error("Reconnecting"));
      // TODO: Should this line pass no-op or callback?
      self._connect(function() {});
      return;
    }
  });

  this._zk.on(ZK.on_event_deleted, function(client, lock) {
    log.trace1('on_event_deleted');
    if (self._watching[lock]) {
      var callbacks = self._watching[lock];
      delete self._watching[lock];
      callbacks.forEach(function(callback){
        callback();
      });
    }
  });

  this._zk.init({
    connect: this._urls,
    timeout: this._timeout,
    debug_level: ZK.ZOO_LOG_LEVEL_WARN,
    host_order_deterministic: false
  });
};


/**
 * @param {Function} callback A callback(err) called on completion.
 */
ZkCxn.prototype._close = function(callback) {
  log.trace1('ZkCxn._close');
  this._changeState(this.cxnStates.CLOSED);
  this._zk.close();
  callback();
};


/**
 * Closes the connection.
 * TODO: Should this be public?
 * @param {Function} callback A callback(err) called when closed.
 */
ZkCxn.prototype.close = function(callback) {
  log.trace1('ZkCxn.close');
  if (this._cxnState === this.cxnStates.CLOSED) {
    // either the caller called close() twice, or we haven't connected yet.
    // either way we shouldn't close now.
    this.onConnection(this._close.bind(this, callback));
    return;
  }
  this._close(callback);
};


/**
 * Ensure a path exists in zk.
 *
 * @param {String} path The path to create - e.g. /foo/bar/ponies.
 * @param {String} value ?
 * @param {Number} flags Bitmask of flags.
 * @param {Function} callback Callback called with (err).
 */
ZkCxn.prototype._createPath = function(path, value, flags, callback) {
  var self = this, one, parts, paths = [], i;
  log.trace1f('ZkCxn._createPath', {path: path});
  if (path.indexOf('/') === 0) {
    path = path.substring(1);
  }
  if (path.length === 0) {
    // path was '', or '/' indicating a top-level lock node, '/' always exists
    callback();
    return;
  }

  parts = path.split('/').filter(function(i) { return i; });
  for (i=1; i<=parts.length; i++) {
    one = '/' + parts.slice(0, i).join('/');
    paths.push(one);
  }

  async.forEachSeries(paths, function(path, callback) {
    self._create(path, value, flags, callback);
  }, callback);
};


/**
 * Create a ZK node
 *
 * @param {String} path The path to create, must begin with '/'.
 * @param {String} value The Value.
 * @param {Number} flags Bitmask of flags.
 * @param {Function} callback Completion callback taking (err, stat).
 */
ZkCxn.prototype._create = function(path, value, flags, callback) {
  var self = this;
  log.trace1f('ZkCxn._create', {path: path});
  if (path[0] !== '/') {
    callback(new Error('A zookeeper path must begin with "/" !'));
    return;
  }
  this._zk.a_create(path, value, flags, function(rc, error, stat) {
    if (rc !== ZK.ZOK && rc !== ZK.ZNODEEXISTS) {
      callback(error);
      return;
    }
    callback(null, stat);
  });
};


/**
 * @param {String} path The Path.
 * @param {Boolean} watch Place a watch on this path.
 * @param {Function} callback Completion Callback.
 */
ZkCxn.prototype._getChildren = function(path, watch, callback) {
  log.trace1f('ZkCxn._getChildren', {path: path});
  // The native zk library doesn't like a path ending in /
  if (path.length > 1 && path.slice(-1) === '/') {
    path = path.slice(0, -1);
  }

  this._zk.a_get_children(path, watch, function(rc, error, children) {
    if (rc !== ZK.ZOK) {
      callback(error);
      return;
    }
    callback(null, children);
  });
};


/**
 * Does a path exist?
 * @param {String} path The path.
 * @param {Boolean} watch Add a watch for this path.
 * @param {Function} callback Completion callback.
 */
ZkCxn.prototype._exists = function(path, watch, callback) {
  log.trace1f('ZkCxn._exists', {path: path});
  this._zk.a_exists(path, watch, function(rc, error, stat) {
    if (rc === ZK.ZNONODE) {
      callback(null, false);
    } else if (rc === ZK.ZOK) {
      callback(null, true);
    } else {
      callback(new ZkError(rc, error));
    }
  });
};


/**
 * Watch a path
 *
 * TODO _watching should be a map to an array of functions
 * @param {String} path The Path.
 * @param {Function} callback Completion Callback.
 */
ZkCxn.prototype._watch = function(path, callback) {
  var self = this;
  log.trace1f('ZkCxn._watch', {path: path});
  // this exists call just ensures there's a watch on this path
  self._exists(path, true, function(err, exists) {
    if (err) {
      callback(err);
      return;
    }
    self._watching[path] = self._watching[path] || [];
    self._watching[path].push(callback);
  });
};


/**
 * A class wrapping the native library's error return values.
 * @constructor
 *
 * @param {String} rc A return code.
 * @param {String} error The error message.
 */
function ZkError(rc, error) {
  Error.call(this, error);
  Error.captureStackTrace(this, this.constructor);
  this.rc = rc;
  this.message = error;
}


util.inherits(ZkError, Error);


exports.ZkError = ZkError;
