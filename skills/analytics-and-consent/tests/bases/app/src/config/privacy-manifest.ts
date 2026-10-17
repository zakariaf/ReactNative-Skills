// src/config/privacy-manifest.ts
// Fixture: privacy-and-store-declarations' manifest module, trimmed (the app.config.ts example spreads it).
export const PRIVACY_MANIFESTS = {
  NSPrivacyTracking: false,
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    },
  ],
};
