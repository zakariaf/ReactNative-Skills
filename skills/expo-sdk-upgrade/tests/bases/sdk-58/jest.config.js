// jest.config.js (fixture excerpt of the canonical config, SDK 58)
const PATH_ALIASES = {
  // jest-expo 58 maps this to react-native/src/asset-registry, which React Native 0.88's exports map
  // hides from the Reanimated resolver; point it at the file itself.
  '^react-native/asset-registry$': '<rootDir>/node_modules/react-native/src/asset-registry.js',
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@test/(.*)$': '<rootDir>/test/$1',
};

const SHARED = {
  rootDir: __dirname,
  preset: 'jest-expo/ios',
  // Reanimated 4.7 / Worklets 0.13: pick the non-native (web) implementations under Jest.
  resolver: 'react-native-reanimated/jest/resolver',
  moduleNameMapper: PATH_ALIASES,
  clearMocks: true,
};

module.exports = { projects: [{ ...SHARED, displayName: 'unit' }] };
