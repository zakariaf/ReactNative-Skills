# modules/time-change/ios/TimeChange.podspec
# A local Expo module: autolinking finds it in ./modules (package.json expo.autolinking.nativeModulesDir)
# and needs no package.json. The shape of the sdk-57 template `npx create-expo-module --local` writes.
Pod::Spec.new do |s|
  s.name           = 'TimeChange'
  s.version        = '1.0.0'
  s.summary        = 'Time zone, clock and day changes of the device, for the app'
  s.author         = 'the app'
  s.homepage       = 'https://example.invalid'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.swift'
end
