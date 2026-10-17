// jest.sim.config.js — simulations only (`npm run test:sim`). Never part of pre-commit or `npm test`.
// Plain Node environment: a sim that needs a React Native mock is a bug (simulated logic is pure TS).
process.env.TZ = 'UTC';

/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  displayName: 'sim',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.sim.test.ts', '<rootDir>/test/**/*.sim.test.ts'],
  transform: {
    '\\.ts$': ['babel-jest', { caller: { name: 'metro', bundler: 'metro', platform: 'ios' } }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  modulePathIgnorePatterns: [
    '<rootDir>/(ios|android|build|dist|web-build)/',
    '<rootDir>/(skills|\\.stryker-tmp|\\.skill-tooling)/',
    '<rootDir>/\\.(agents|claude|codex|cursor|windsurf|roo|cline|continue|kiro)/',
  ],
  testTimeout: 300_000,
};
