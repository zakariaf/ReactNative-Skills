// __mocks__/expo-iap.ts — root manual mock (automatic in every Jest project). expo-iap 5.8.0 ships no
// Jest mock and its native module does not exist in Jest. Only the purchase adapter
// (src/services/purchase/) imports it.
// Banned APIs (kitApi, verifyPurchaseWithProvider, ...) are deliberately NOT mocked: calling one throws.
// An adapter test reads these jest.fn()s via jest.mock('expo-iap') + jest.requireMock('expo-iap').
function subscription() {
  return { remove: jest.fn() };
}

export const initConnection = jest.fn(() => Promise.resolve(true));
export const endConnection = jest.fn(() => Promise.resolve(true));
export const fetchProducts = jest.fn(() => Promise.resolve([] as unknown[]));
export const requestPurchase = jest.fn(() => Promise.resolve(null));
export const finishTransaction = jest.fn(() => Promise.resolve());
export const restorePurchases = jest.fn(() => Promise.resolve());
export const getAvailablePurchases = jest.fn(() => Promise.resolve([] as unknown[]));
export const purchaseUpdatedListener = jest.fn(subscription);
export const purchaseErrorListener = jest.fn(subscription);

// The real enum: build/types.js is plain JS without native code, so the mock can never drift from it.
export { ErrorCode } from 'expo-iap/build/types.js';
