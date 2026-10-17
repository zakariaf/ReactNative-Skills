// jest.config.js
const fs = require('node:fs');

const IGNORED_PATHS = ['<rootDir>/(ios|android|build|dist)/', '<rootDir>/(coverage|reports|skills|\\.stryker-tmp)/', '<rootDir>/\\.(agents|claude|codex|cursor)/'];
const thresholds = Object.fromEntries(['./src/core/'].filter((key) => fs.existsSync(key)).map((key) => [key, { statements: 90 }]));

module.exports = {
  projects: [
    { displayName: 'unit', preset: 'jest-expo/ios', modulePathIgnorePatterns: IGNORED_PATHS, testPathIgnorePatterns: ['/node_modules/', ...IGNORED_PATHS] },
    { displayName: 'android', preset: 'jest-expo/android', testMatch: ['**/*.android.test.ts'], modulePathIgnorePatterns: IGNORED_PATHS },
  ],
  coverageThreshold: { global: { statements: 90 }, ...thresholds },
};
