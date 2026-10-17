// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const { withWebSqlite } = require('./scripts/metro/web-sqlite-metro.ts');

const config = getDefaultConfig(__dirname);

module.exports = withWebSqlite(config);
