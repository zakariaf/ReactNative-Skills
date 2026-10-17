// jest.sim.config.js (multi-package)
process.env.TZ = 'UTC';

module.exports = {
  rootDir: __dirname,
  displayName: 'sim',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/{apps,packages}/*/src/**/*.sim.test.ts', '<rootDir>/test/**/*.sim.test.ts'],
  modulePathIgnorePatterns: [
    '<rootDir>/apps/[^/]+/(ios|android|build)/',
    '<rootDir>/(skills|\\.stryker-tmp|\\.skill-tooling)/',
    '<rootDir>/\\.(agents|claude|codex|cursor|windsurf|roo|cline|continue|kiro)/',
  ],
  testTimeout: 300_000,
};
