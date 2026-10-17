// metro.config.js
// Plain JavaScript: Metro loads this file directly. Metro inlines every EXPO_PUBLIC_* value into the
// transformed code of a production bundle, but those values are not part of its cache key, and the
// cache (metro-cache in the system temp folder) is shared by every build on the machine. Without the
// key below, a production export made after a development export reused the development transforms
// (verified on Expo SDK 57: the same bundle, test-only code and variant included). Keying the cache
// on the public values makes every variant, and every change of a public value, transform afresh.
// Requiring the .ts helper needs Node 22.18 or newer (type stripping on by default) wherever Metro
// loads this file, EAS Build workers included: SDK 57 EAS images ship Node 22.23.1, so only an eas.json
// profile that pins an older "node" breaks it (check-variants reports such a pin).
// The Metro slot: an optional kit that needs Metro (crash reporting's debug ids) is listed in the
// app's scripts/metro/metro-kits.ts and composed here; without that file the config is Expo's default.
// A kit never edits this file, and the cache key below stays on the final object.
const { getDefaultConfig } = require('expo/metro-config');

const { composeMetroConfig, readMetroKits } = require('./scripts/metro/compose-metro-config.ts');
const { publicEnvCacheVersion } = require('./scripts/metro/public-env-cache-version.ts');

const config = composeMetroConfig(__dirname, getDefaultConfig, readMetroKits(__dirname));
config.cacheVersion = publicEnvCacheVersion(process.env);

module.exports = config;
