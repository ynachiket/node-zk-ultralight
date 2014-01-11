Vagrant::Config.run do |config|
  config.vm.box = "precise64"
  config.vm.box_url = "http://files.vagrantup.com/precise64.box"

  config.cache.auto_detect = true
  config.cache.enable_nfs  = true
  config.cache.enable :npm

  config.vm.provision :puppet do |puppet|
    puppet.manifests_path = "manifests"
    puppet.manifest_file  = "precise.pp"
  end
end
