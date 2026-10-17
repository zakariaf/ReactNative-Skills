// __mocks__/expo-haptics.ts: Jest root mocks mirror the module shape, default export included.
const haptics = { impactAsync: jest.fn(async () => undefined) };

export default haptics;
