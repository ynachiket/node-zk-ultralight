Vagrant::Config.run do |config|
  config.vm.box = "precise"
  config.vm.box_url = "http://dl.dropbox.com/u/1537815/precise64.box"

  config.vm.provision :puppet do |puppet|
    puppet.manifests_path = "manifests"
    puppet.manifest_file  = "precise.pp"
  end
end
