// jest.config.js (a stand-in: unit-and-component-tests owns the real file)
module.exports = {
  projects: [
    { displayName: 'unit', preset: 'jest-expo/ios', testPathIgnorePatterns: ['\\.golden\\.test\\.'] },
    {
      displayName: 'golden',
      preset: 'jest-expo/ios',
      testEnvironment: '@shopify/react-native-skia/jestEnv.js',
      setupFilesAfterEnv: ['@shopify/react-native-skia/jestSetup.js'],
      testMatch: ['<rootDir>/**/*.golden.test.ts'],
    },
  ],
};
