exec { "apt-update":
  command => "/usr/bin/apt-get update"
}

Exec["apt-update"] -> Package <| |>

package { ["g++", "curl", "git", "build-essential", "python", "python-dev", "python-setuptools", "python-software-properties"]:
  ensure => present,
}

exec { "ppa:node.js-legacy":
  command => "/usr/bin/add-apt-repository ppa:chris-lea/node.js-legacy && /usr/bin/apt-get update",
  require => Package['python-software-properties'],
}

# https://launchpad.net/~chris-lea/+archive/node.js-legacy
package { "nodejs":
  ensure => "0.8.26-1chl1~precise1",
  require => Exec['ppa:node.js-legacy']
}

package {"npm":
  ensure => present,
  require => Package['nodejs']
}

exec { "node-gyp":
  command => '/usr/bin/npm install -g node-gyp@0.12.2',
  require => Package['npm']
}

package { "zookeeperd":
  ensure => present,
}

package { "zookeeper":
  ensure => present,
}
