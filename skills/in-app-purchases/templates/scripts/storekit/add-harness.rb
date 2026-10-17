# scripts/storekit/add-harness.rb
# Usage: ruby scripts/storekit/add-harness.rb <ios-dir> <AppTarget> <bundle-id>
# Adds the hosted StoreKit test target to a freshly prebuilt ios/ project (harness builds only),
# with the xcodeproj gem that ships with CocoaPods. Idempotent: exits early if already added.
require 'xcodeproj'

ios_dir, app_name, bundle_id = ARGV
abort('usage: add-harness.rb <ios-dir> <AppTarget> <bundle-id>') unless ios_dir && app_name && bundle_id
project_path = File.join(ios_dir, "#{app_name}.xcodeproj")
project = Xcodeproj::Project.open(project_path)
exit 0 if project.targets.any? { |t| t.name == 'StoreKitHarness' }
app = project.targets.find { |t| t.name == app_name } or abort("no target #{app_name}")

storekit = project.main_group.new_file('Premium.storekit') # the file sits in <ios-dir>/
app.add_resources([storekit])

harness = project.new_target(:unit_test_bundle, 'StoreKitHarness', :ios, '16.4')
group = project.main_group.new_group('StoreKitHarness', 'StoreKitHarness')
harness.add_file_references([group.new_file('ArmTests.swift')])
harness.add_resources([storekit])
harness.add_dependency(app)
harness.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)' # avoids "Multiple commands produce .../PlugIns/.xctest"
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{bundle_id}.storekit-harness"
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['SWIFT_VERSION'] = '5.0'
  s['TEST_HOST'] = "$(BUILT_PRODUCTS_DIR)/#{app_name}.app/#{app_name}"
  s['BUNDLE_LOADER'] = '$(TEST_HOST)'
  s['CODE_SIGN_STYLE'] = 'Manual'
  s['CODE_SIGN_IDENTITY'] = '-'
end
# The debug-signing entitlement in the Debug configuration only: without it storekitd ignores the
# SKTestSession (SKInternalErrorDomain Code=3) and products come back empty, silently.
app.build_configurations.each do |config|
  next unless config.name == 'Debug'
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = "#{app_name}/storekit-harness.entitlements"
end
project.save

scheme_path = File.join(project_path, 'xcshareddata', 'xcschemes', "#{app_name}.xcscheme")
scheme = Xcodeproj::XCScheme.new(scheme_path)
scheme.add_test_target(harness)
scheme.save!
puts "StoreKitHarness added to #{project_path}"
