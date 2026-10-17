// jest.config.js (trimmed to what the checkers read): the path aliases in the order Jest needs them.
// Jest takes the first moduleNameMapper pattern that matches, so the assets folder comes before "@/".
const PATH_ALIASES = {
  '^@/assets/(.*)$': '<rootDir>/assets/$1',
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@test/(.*)$': '<rootDir>/test/$1',
};

module.exports = {
  preset: 'jest-expo/ios',
  moduleNameMapper: PATH_ALIASES,
};
