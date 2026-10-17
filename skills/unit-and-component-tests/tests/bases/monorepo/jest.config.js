// jest.config.js (multi-package): one config at the repo root; workspaces by package name.
const fs = require('node:fs');
const path = require('node:path');

const { deviceOnlyCoveragePatterns } = require('./scripts/quality/device-only.ts');

process.env.TZ = 'UTC';

const TRANSPILE_PACKAGES = ['react-native', '@react-native', 'expo', '@expo'];
const transformIgnorePatterns = [
  `/node_modules/(?!(${TRANSPILE_PACKAGES.join('|')}))`,
  '/node_modules/react-native-reanimated/plugin/',
  '/node_modules/@react-native/babel-preset/',
];
const IGNORED_PATHS = [
  '<rootDir>/apps/[^/]+/(ios|android|build|dist)/',
  '<rootDir>/(coverage|reports|skills|\\.stryker-tmp|\\.skill-tooling)/',
  '<rootDir>/\\.(agents|claude|codex|cursor|windsurf|roo|cline|continue|kiro)/',
];
// Each workspace package name straight to its source, never through the node_modules symlinks.
const WORKSPACE_MODULES = {
  '^@acme/core/(.*)$': '<rootDir>/packages/core/src/$1',
  '^@acme/mobile/(.*)$': '<rootDir>/apps/mobile/src/$1',
};
const SHARED = {
  rootDir: __dirname,
  preset: 'jest-expo/ios',
  transformIgnorePatterns,
  moduleNameMapper: WORKSPACE_MODULES,
  modulePathIgnorePatterns: IGNORED_PATHS,
  testPathIgnorePatterns: ['/node_modules/', ...IGNORED_PATHS],
  clearMocks: true,
  restoreMocks: true,
  coveragePathIgnorePatterns: ['/node_modules/', ...deviceOnlyCoveragePatterns(__dirname)],
};
const TEST_ROOTS = ['<rootDir>/{apps,packages}/*/src/**/', '<rootDir>/scripts/**/', '<rootDir>/test/**/'];
const unitProject = {
  ...SHARED,
  displayName: 'unit',
  testMatch: TEST_ROOTS.map((root) => `${root}*.test.{ts,tsx}`),
  testPathIgnorePatterns: [
    ...SHARED.testPathIgnorePatterns,
    '\\.golden\\.test\\.',
    '\\.sim\\.test\\.',
    '\\.android\\.test\\.',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
const androidProject = {
  ...SHARED,
  displayName: 'android',
  preset: 'jest-expo/android',
  testMatch: TEST_ROOTS.map((root) => `${root}*.android.test.{ts,tsx}`),
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
const LOGIC = { statements: 95, lines: 95, functions: 95, branches: 90 };
const LOGIC_THRESHOLDS = {
  './apps/mobile/src/core/': 'apps/mobile/src/core/**/*.ts',
  './packages/core/src/': 'packages/core/src/**/*.ts',
};
const hasSourceFiles = (glob) =>
  fs.globSync(glob, { cwd: __dirname }).some((file) => !/\.test\.ts$/.test(path.basename(file)));

/** @type {import('jest').Config} */
module.exports = {
  projects: [unitProject, androidProject],
  collectCoverageFrom: [
    '<rootDir>/{apps,packages}/*/src/**/*.{ts,tsx}',
    '!**/*.{test,golden.test,sim.test}.{ts,tsx}',
    '!**/*.d.ts',
    '!**/fixtures/**',
    '!**/testing/**',
  ],
  coverageDirectory: '<rootDir>/reports/coverage',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 90, lines: 90, functions: 90, branches: 85 },
    ...Object.fromEntries(
      Object.entries(LOGIC_THRESHOLDS)
        .filter(([, glob]) => hasSourceFiles(glob))
        .map(([key]) => [key, LOGIC]),
    ),
  },
};
