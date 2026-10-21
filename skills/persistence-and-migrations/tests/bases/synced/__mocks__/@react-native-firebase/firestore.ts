// __mocks__/@react-native-firebase/firestore.ts: the Jest stand-in for the native module.
export const getFirestore = jest.fn(() => ({}));
export const writeBatch = jest.fn(() => ({ set: jest.fn(), commit: jest.fn(async () => undefined) }));
