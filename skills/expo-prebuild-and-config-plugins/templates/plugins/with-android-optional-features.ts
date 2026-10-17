// plugins/with-android-optional-features.ts
// A local config plugin: marks Android hardware features the app can live without as optional.
// Some permissions imply a required feature (CAMERA implies android.hardware.camera and
// android.hardware.camera.autofocus), and Google Play hides an app from every device that lacks a
// required feature. An explicit <uses-feature android:required="false"> wins over the implied one.
// Expo has no config key and expo-build-properties no option for <uses-feature>, so this is a plugin.
// iOS needs nothing: UIRequiredDeviceCapabilities only ever narrows the devices.
// app.config.ts lists it by path:
//   ['./plugins/with-android-optional-features.ts', { features: ['android.hardware.camera'] }]
// Node loads this file (Expo's config loader, Jest), so Expo's helpers come from
// 'expo/config-plugins.js' on SDK 57 (expo has no exports map there; SDK 58 drops the .js).
import { withAndroidManifest } from 'expo/config-plugins.js';

import type { AndroidConfig, ConfigPlugin } from 'expo/config-plugins.js';

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;
type UsesFeature = NonNullable<AndroidManifest['manifest']['uses-feature']>[number];

/** The plugin's options in app.config.ts. */
export type OptionalFeaturesOptions = { readonly features: readonly string[] };

/** Android feature names: android.hardware.* or android.software.*, lower case. */
const FEATURE_NAME = /^android\.(hardware|software)\.[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** Checks the options and returns the feature names without duplicates, in the order given. */
export function validateFeatures(options: OptionalFeaturesOptions | undefined): readonly string[] {
  if (options === undefined || options.features.length === 0) {
    throw new Error(
      "withAndroidOptionalFeatures: list the features: ['./plugins/with-android-optional-features.ts', { features: ['android.hardware.camera'] }].",
    );
  }
  for (const feature of options.features) {
    if (!FEATURE_NAME.test(feature)) {
      throw new Error(
        `withAndroidOptionalFeatures: "${feature}" is not an Android feature name (e.g. android.hardware.camera).`,
      );
    }
  }
  return [...new Set(options.features)];
}

function optional(feature: string): UsesFeature {
  return { $: { 'android:name': feature, 'android:required': 'false' } };
}

/**
 * The manifest with each feature declared once as not required: an existing declaration of the
 * feature is replaced (a required="true" one included), every other entry is kept as it was.
 */
export function addOptionalFeatures(
  manifest: AndroidManifest,
  features: readonly string[],
): AndroidManifest {
  const existing = manifest.manifest['uses-feature'] ?? [];
  const kept = existing.filter((entry) => !features.includes(entry.$['android:name']));
  const declared = [...kept, ...features.map(optional)];
  return { ...manifest, manifest: { ...manifest.manifest, 'uses-feature': declared } };
}

const withAndroidOptionalFeatures: ConfigPlugin<OptionalFeaturesOptions | undefined> = (
  config,
  options,
) => {
  const features = validateFeatures(options);
  return withAndroidManifest(config, (next) => ({
    ...next,
    modResults: addOptionalFeatures(next.modResults, features),
  }));
};

/** @public Expo loads it from the path app.config.ts names, so it is the default export. */
export default withAndroidOptionalFeatures;
