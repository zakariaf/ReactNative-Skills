# modules/task-checksum/TaskChecksum.podspec
# A React Native library pod. It sits at the package root: Expo autolinking looks for a React
# Native module's podspec there (expo-modules-autolinking 57.0.13, iosResolver), not in ios/ as for
# an Expo module. install_modules_dependencies adds React-Core, codegen and the New Architecture flags.
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'TaskChecksum'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://example.invalid'
  s.license      = 'MIT'
  s.author       = 'the app'
  s.platforms    = { :ios => '16.4' }
  s.source       = { git: '' }
  s.source_files = 'ios/*.{h,mm}', 'cpp/*.{h,cpp}'

  install_modules_dependencies(s)
end
