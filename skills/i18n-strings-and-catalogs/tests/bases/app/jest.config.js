// jest.config.js (fixture: the canonical setupFiles pattern, trimmed)
const fs = require('node:fs');
const path = require('node:path');

const INTL_POLYFILLS = 'src/i18n/intl-polyfills.ts';
const POLYFILL_SETUP = fs.existsSync(path.join(__dirname, INTL_POLYFILLS))
  ? [`<rootDir>/${INTL_POLYFILLS}`]
  : [];

const SHARED = { rootDir: __dirname, preset: 'jest-expo/ios', setupFiles: POLYFILL_SETUP };

module.exports = {
  projects: [
    { ...SHARED, displayName: 'unit' },
    { ...SHARED, displayName: 'golden' },
  ],
};
