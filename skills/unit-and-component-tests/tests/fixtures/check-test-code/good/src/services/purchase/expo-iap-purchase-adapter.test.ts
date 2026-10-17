// src/services/purchase/expo-iap-purchase-adapter.test.ts
import { createExpoIapPurchaseAdapter } from './expo-iap-purchase-adapter';

jest.mock('expo-iap');

type MockedIap = {
  readonly fetchProducts: jest.Mock<Promise<unknown[]>>;
};

const iap = jest.requireMock<MockedIap>('expo-iap');

describe('createExpoIapPurchaseAdapter', () => {
  it('maps an empty product list to no product', async () => {
    iap.fetchProducts.mockResolvedValueOnce([]);

    await expect(createExpoIapPurchaseAdapter().fetchProduct('tasks.premium')).resolves.toBeNull();
  });
});
