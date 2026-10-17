// fingerprint.config.js
// What the runtime version (runtimeVersion { policy: 'fingerprint' }) hashes beyond the defaults
// of @expo/fingerprint (the ota-updates skill). Measured with expo-updates 57.0.24 and
// @expo/fingerprint 0.20.13 on 2026-10-14 (npx expo-updates runtimeversion:resolve):
// - package.json scripts: by default every script is hashed, so editing the "lint" script gave every
//   binary a new runtime version and the next update reached no phone. Only the scripts npm or EAS
//   run while installing or building can change the native output; only they stay in the hash.
// - the app version (version, ios.buildNumber, android.versionCode): a store release that bumps only
//   the version keeps its native layer, so it keeps receiving the same updates.
// Never skip more (the whole Expo config, plugins, the lockfile): each one is a native input.
// @expo/fingerprint swallows an error thrown while loading this file and silently uses its
// defaults, so scripts/ota/fingerprint-config.test.ts loads it.

/**
 * Scripts npm or EAS Build run on their own: they can patch or generate native code. npm runs
 * preinstall, install, postinstall, then preprepare, prepare and postprepare during `npm ci`.
 */
const NATIVE_LIFECYCLE_SCRIPT = /^(?:pre|post)?(?:install|prepare)$|^eas-build-/;

/**
 * Keeps only the native lifecycle scripts of package.json in the hash.
 * @param {string} scriptsJson package.json "scripts", as @expo/fingerprint serialized it
 * @returns {string}
 */
function nativeLifecycleScripts(scriptsJson) {
  const scripts = JSON.parse(scriptsJson);
  const kept = Object.entries(scripts).filter(([name]) => NATIVE_LIFECYCLE_SCRIPT.test(name));
  return JSON.stringify(Object.fromEntries(kept));
}

/** @type {import('expo/fingerprint').Config} */
const config = {
  // The two version skips, plus the default this list replaces (expo prebuild's android/ios scripts).
  sourceSkips: [
    'ExpoConfigVersions',
    'ExpoConfigRuntimeVersionIfString',
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
  ],
  fileHookTransform: (source, chunk) => {
    if (source.type !== 'contents' || source.id !== 'packageJson:scripts' || chunk === null) {
      return chunk;
    }
    return nativeLifecycleScripts(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  },
};

module.exports = config;
