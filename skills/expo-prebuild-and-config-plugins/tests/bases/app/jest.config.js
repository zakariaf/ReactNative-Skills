// jest.config.js
const TEST_ROOTS = ['<rootDir>/src/**/', '<rootDir>/scripts/**/', '<rootDir>/test/**/', '<rootDir>/plugins/**/'];

module.exports = {
  projects: [
    {
      displayName: 'unit',
      rootDir: __dirname,
      testMatch: TEST_ROOTS.map((root) => `${root}*.test.{ts,tsx}`),
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/(ios|android|build|dist)/'],
    },
  ],
};
