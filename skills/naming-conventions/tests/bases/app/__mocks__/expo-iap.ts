// __mocks__/expo-iap.ts: root manual mock; mirrors the library's own export names.
export const ErrorCode = { E_USER_CANCELLED: 'E_USER_CANCELLED' } as const;
export const requestPurchase = jest.fn();
