<a href="https://nodei.co/npm-dl/zk-ultralight/"><img src="https://nodei.co/npm-dl/zk-ultralight.png"></a>
# Ultralight ZK locking utility

Slimmer profile, low-calorie distributed locking library based on [node-zookeeper-client](https://github.com/racker/node-zookeeper-client)

## Why a new library?

* Mildly different, much smaller interface
* Fewer features (no master election)
* Incompatible locking strategy

## Locking strategy

Like `node-zookeeper-client`, node-zk-ultralight's locking is based on [the ZooKeeper lock recipe.](http://zookeeper.apache.org/doc/trunk/recipes.html#sc_recipes_Locks)

The key difference: the ZK lock recipe recommends negotiating for the lock under the requested lock node with child nodes like `_locknode_/guid-lock-<sequence number>`. However, [ephemeral nodes may not have children](http://zookeeper.apache.org/doc/r3.2.1/zookeeperProgrammers.html#Ephemeral+Nodes), so applications with a large number of unique locks, especially a monotonically increasing number of locks (such as locking on a unique timestamp), pose a management problem. Locks created with node-zk-ultralight are ephemeral, and when no longer needed, they'll evaporate like the morning dew with the sunrise.

## Usage

```javascript
function someAsyncActionWithLocking(callback) {
  var cxn = zkultra.getCxn(settings.ZOOKEEPER_URLS);
  async.series([
    cxn.lock.bind(cxn, '/some/lock/i/need', process.title +'-'+ process.pid),
    someAsyncAction,
    cxn.unlock.bind(cxn, '/some/lock/i/need')
  ], callback);
};
```

## Development

### Building

```bash
$ git clone https://github.com/racker/node-zk-ultralight
$ cd node-zk-ultralight
$ npm install .
$ vagrant up
$ vagrant ssh
$ cd /vagrant
$ make
```

### Running tests

`npm run-script test`

### Running lint

`npm run-script lint`

[![Dependency Status](https://david-dm.org/rackerlabs/node-zk-ultralight.png)](https://david-dm.org/rackerlabs/node-zk-ultralight)

# License

Library is distributed under the [Apache license](http://www.apache.org/licenses/LICENSE-2.0.html).
