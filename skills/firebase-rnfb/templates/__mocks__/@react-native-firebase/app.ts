// __mocks__/@react-native-firebase/app.ts
// Root manual mock (automatic in every Jest project): the native module does not exist in Jest. Only
// adapters import the package; their tests read these jest.fn()s through jest.requireMock.
export const getApp = jest.fn(() => ({ name: '[DEFAULT]' }));
