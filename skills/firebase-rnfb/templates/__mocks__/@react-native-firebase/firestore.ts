// __mocks__/@react-native-firebase/firestore.ts
// Root manual mock (automatic in every Jest project). Only the modular functions the adapters use are
// mocked; anything else is undefined, so a call to it fails loudly. Paths are joined with "/" and new
// document ids count up, so a test can assert exactly what a batch wrote.
type Ref = { readonly path: string; readonly id: string };

let nextId = 0;

export const CACHE_SIZE_UNLIMITED = -1;
export const initializeFirestore = jest.fn(() => ({ type: 'firestore' }));
export const getFirestore = jest.fn(() => ({ type: 'firestore' }));
export const connectFirestoreEmulator = jest.fn();
export const collection = jest.fn((_db: unknown, ...segments: string[]): Ref => {
  const path = segments.join('/');
  return { path, id: segments[segments.length - 1] ?? '' };
});
export const doc = jest.fn((parent: Ref, ...segments: string[]): Ref => {
  nextId += 1;
  const id = segments.length > 0 ? segments.join('/') : `generated-${String(nextId)}`;
  return { path: `${parent.path}/${id}`, id };
});
export const query = jest.fn((ref: Ref, ...constraints: unknown[]) => ({ ref, constraints }));
export const where = jest.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
export const serverTimestamp = jest.fn(() => ({ sentinel: 'serverTimestamp' }));
export const increment = jest.fn((by: number) => ({ sentinel: 'increment', by }));
export const writeBatch = jest.fn(() => ({
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn(() => Promise.resolve()),
}));
export const onSnapshot = jest.fn(() => jest.fn());
