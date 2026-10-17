# modules/process-start/ios/ProcessStart.podspec
# A local Expo module (autolinking searches ./modules by default); it needs no package.json.
# Mirrors expo-module-template-local 0.7.10's podspec.
Pod::Spec.new do |s|
  s.name           = 'ProcessStart'
  s.version        = '1.0.0'
  s.summary        = 'The wall-clock start time of the app process, for cold-start measurement'
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
