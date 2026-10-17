// src/config/privacy-manifest.ts
// The app's iOS privacy manifest: app.config.ts sets ios: { privacyManifests: PRIVACY_MANIFESTS }
// and prebuild writes ios/<App>/PrivacyInfo.xcprivacy from it (never edit ios/ by hand). Apple does
// not reliably read static pods' manifests, so this declares every required-reason API any pod of
// the app declares. The starting set is what every Expo SDK 57 app ships (react-native 0.86,
// expo-file-system, expo-constants: read from their own manifests on 2026-10-14); after a prebuild,
// npm run audit:privacy lists what the app's other pods add. NSPrivacyTracking stays false and no
// NSPrivacyTrackingDomains are listed: the app's own code tracks nothing, and iOS fails requests to
// listed domains for everyone who declines App Tracking Transparency.
export const PRIVACY_MANIFESTS = {
  NSPrivacyTracking: false,
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    },
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
      NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'],
    },
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
      NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
    },
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
      NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'],
    },
  ],
};
