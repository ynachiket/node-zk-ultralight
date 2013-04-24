exec { "apt-update":
  command => "/usr/bin/apt-get update"
}

Exec["apt-update"] -> Package <| |>

package { ["npm", "g++", "curl", "git", "build-essential"]:
  ensure => present,
}

exec { "node-gyp":
  command => '/usr/bin/npm install -g node-gyp@0.8.0',
  require => Package['npm']
}

package { "zookeeperd":
  ensure => present,
}

package { "zookeeper":
  ensure => present,
}
