// jest.config.js (fixture excerpt of the canonical config)
const PATH_ALIASES = {
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@test/(.*)$': '<rootDir>/test/$1',
};

const SHARED = {
  rootDir: __dirname,
  preset: 'jest-expo/ios',
  moduleNameMapper: PATH_ALIASES,
  clearMocks: true,
};

module.exports = { projects: [{ ...SHARED, displayName: 'unit' }] };
