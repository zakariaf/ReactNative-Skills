// src/services/purchase/expo-iap-purchase-adapter.test.ts — EXAMPLE (a shape to imitate): an adapter
// driven against the root manual mock __mocks__/expo-iap.ts. The test never imports the SDK: the
// explicit jest.mock() makes this file share the instance the adapter imported, and
// jest.requireMock() reads it, typed with only what the assertions need (which also keeps
// @typescript-eslint/unbound-method quiet). Without jest.mock(), requireMock returns a second
// instance and every assertion sees zero calls (verified with Jest 29.7).
import { createExpoIapPurchaseAdapter } from './expo-iap-purchase-adapter';

jest.mock('expo-iap');

type MockedIap = {
  readonly initConnection: jest.Mock<Promise<boolean>>;
  readonly fetchProducts: jest.Mock<Promise<unknown[]>>;
  readonly finishTransaction: jest.Mock<Promise<void>>;
};

const iap = jest.requireMock<MockedIap>('expo-iap');

const STORE_PRODUCT = {
  id: 'tasks.premium',
  displayPrice: '€4.99',
  price: 4.99,
  currency: 'EUR',
  type: 'in-app',
};

describe('createExpoIapPurchaseAdapter', () => {
  it('maps the store product to the port type', async () => {
    iap.fetchProducts.mockResolvedValueOnce([STORE_PRODUCT]);
    const adapter = createExpoIapPurchaseAdapter({ onError: jest.fn() });

    await expect(adapter.fetchProduct('tasks.premium')).resolves.toStrictEqual({
      productId: 'tasks.premium',
      displayPrice: '€4.99',
      price: 4.99,
      currency: 'EUR',
    });
  });

  it('answers no product, and reports the error, when the store is unreachable', async () => {
    const onError = jest.fn();
    const failure = new Error('E_NETWORK_ERROR');
    iap.fetchProducts.mockRejectedValueOnce(failure);

    await expect(
      createExpoIapPurchaseAdapter({ onError }).fetchProduct('tasks.premium'),
    ).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('connects once however often products are fetched', async () => {
    iap.fetchProducts.mockResolvedValue([STORE_PRODUCT]);
    const adapter = createExpoIapPurchaseAdapter({ onError: jest.fn() });

    await adapter.fetchProduct('tasks.premium');
    await adapter.fetchProduct('tasks.premium');

    expect(iap.initConnection).toHaveBeenCalledTimes(1);
  });
});
