// jest.emulator.config.js — the 'emulator' Jest project: security-rules tests (*.rules.test.ts in
// test/rules/) against the Firebase emulators. It is not a project of jest.config.js, because these
// tests need running emulators: `npm run test:rules` starts them with `firebase emulators:exec` and
// runs Jest with this config inside, the way jest.sim.config.js keeps simulations apart.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  displayName: 'emulator',
  // Node, not jest-expo: the tests talk to the emulators through the Firebase JS SDK, no React Native.
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/rules/**/*.rules.test.ts'],
  moduleNameMapper: { '^@test/(.*)$': '<rootDir>/test/$1' },
  // One emulator project for every file: files run one at a time, so one file's clearFirestore()
  // never wipes the documents another file is testing.
  maxWorkers: 1,
  // The first request also compiles the rules in the emulator.
  testTimeout: 20000,
  clearMocks: true,
};
