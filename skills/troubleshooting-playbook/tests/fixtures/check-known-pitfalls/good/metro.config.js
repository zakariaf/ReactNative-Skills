// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const { publicEnvCacheVersion } = require('./scripts/metro/public-env-cache-version.ts');

const config = getDefaultConfig(__dirname);
config.cacheVersion = publicEnvCacheVersion(process.env);

module.exports = config;
