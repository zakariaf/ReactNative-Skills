// src/services/subscription/revenuecat-subscription-adapter.test.ts
import { PACKAGE_TYPE, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { err, ok } from '@/core/result';

import { createRevenueCatSubscriptionAdapter } from './revenuecat-subscription-adapter';
import { NO_ENTITLEMENT } from './subscription-port';

jest.mock('react-native-purchases');

type MockedPurchases = Readonly<Record<string, jest.Mock>>;

const sdk = jest.requireMock<{ default: MockedPurchases }>('react-native-purchases').default;

function sdkCall(name: string): jest.Mock {
  const fn = sdk[name];
  if (fn === undefined) throw new Error(`no mock for ${name}`);
  return fn;
}

const MANAGEMENT_LINK = 'store-management-link';

const OPTIONS = { apiKey: 'appl_public_key', entitlementId: 'premium' };

function infoWith(active: Record<string, unknown>): unknown {
  return { entitlements: { active, all: active }, managementURL: MANAGEMENT_LINK };
}

const PREMIUM_INFO = infoWith({
  premium: {
    isActive: true,
    productIdentifier: 'com.example.tasks.premium.annual',
    expirationDateMillis: 1_900_000_000_000,
    willRenew: true,
    billingIssueDetectedAtMillis: null,
  },
});

const ANNUAL = {
  identifier: '$rc_annual',
  packageType: PACKAGE_TYPE.ANNUAL,
  product: {
    identifier: 'com.example.tasks.premium.annual',
    priceString: 'store-annual-text',
    pricePerMonthString: 'store-per-month-text',
  },
};

function rejectWith(code: string): Promise<never> {
  return Promise.reject(Object.assign(new Error('sdk'), { code }));
}

describe('createRevenueCatSubscriptionAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('configures with the backend user id, never an anonymous one', () => {
    const port = createRevenueCatSubscriptionAdapter(OPTIONS);
    expect(port.configure('user-1')).toStrictEqual(ok(undefined));
    expect(sdkCall('configure')).toHaveBeenCalledWith({
      apiKey: 'appl_public_key',
      appUserID: 'user-1',
    });
  });

  it('maps the current offering with the store price strings unchanged', async () => {
    sdkCall('getOfferings').mockResolvedValueOnce({
      current: { identifier: 'default', availablePackages: [ANNUAL] },
    });
    const offer = await createRevenueCatSubscriptionAdapter(OPTIONS).getOffer();
    expect(offer).toStrictEqual(
      ok({
        offeringId: 'default',
        packages: [
          {
            packageId: '$rc_annual',
            productId: 'com.example.tasks.premium.annual',
            period: 'annual',
            priceText: 'store-annual-text',
            pricePerMonthText: 'store-per-month-text',
          },
        ],
      }),
    );
  });

  it('answers ok(null) when the store returned no packages', async () => {
    await expect(createRevenueCatSubscriptionAdapter(OPTIONS).getOffer()).resolves.toStrictEqual(
      ok(null),
    );
  });

  it('purchases a loaded package and reads the entitlement from the result', async () => {
    sdkCall('getOfferings').mockResolvedValueOnce({
      current: { identifier: 'default', availablePackages: [ANNUAL] },
    });
    sdkCall('purchasePackage').mockResolvedValueOnce({ customerInfo: PREMIUM_INFO });
    const result = await createRevenueCatSubscriptionAdapter(OPTIONS).purchase('$rc_annual');
    expect(result.ok && result.value.isActive).toBe(true);
    expect(sdkCall('purchasePackage')).toHaveBeenCalledWith(ANNUAL);
  });

  it.each([
    [PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR, 'cancelled'],
    [PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR, 'pending'],
    [PURCHASES_ERROR_CODE.NETWORK_ERROR, 'network'],
    [PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR, 'store-unavailable'],
    [PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR, 'already-owned'],
    ['999', 'unknown'],
  ])('turns SDK error %s into %s, never a rejection', async (code, kind) => {
    sdkCall('getOfferings').mockResolvedValueOnce({
      current: { identifier: 'default', availablePackages: [ANNUAL] },
    });
    sdkCall('purchasePackage').mockImplementationOnce(() => rejectWith(code));
    const result = await createRevenueCatSubscriptionAdapter(OPTIONS).purchase('$rc_annual');
    expect(result).toStrictEqual(err({ kind, code }));
  });

  it('fails an unknown package as store-unavailable without opening a sheet', async () => {
    const result = await createRevenueCatSubscriptionAdapter(OPTIONS).purchase('$rc_weekly');
    expect(result.ok ? null : result.error.kind).toBe('store-unavailable');
    expect(sdkCall('purchasePackage')).not.toHaveBeenCalled();
  });

  it('restores and switches users through the SDK', async () => {
    sdkCall('restorePurchases').mockResolvedValueOnce(PREMIUM_INFO);
    const port = createRevenueCatSubscriptionAdapter(OPTIONS);
    const restored = await port.restore();
    expect(restored.ok && restored.value.productId).toBe('com.example.tasks.premium.annual');
    await expect(port.logIn('user-2')).resolves.toStrictEqual(ok(NO_ENTITLEMENT));
    expect(sdkCall('logIn')).toHaveBeenCalledWith('user-2');
    await expect(port.logOut()).resolves.toStrictEqual(ok(undefined));
  });

  it('delivers customer info changes until the unsubscribe', () => {
    const seen: boolean[] = [];
    const stop = createRevenueCatSubscriptionAdapter(OPTIONS).onEntitlementChange((entitlement) => {
      seen.push(entitlement.isActive);
    });
    const listener = sdkCall('addCustomerInfoUpdateListener').mock.calls[0]?.[0] as (
      info: unknown,
    ) => void;
    listener(PREMIUM_INFO);
    stop();
    expect(seen).toStrictEqual([true]);
    expect(sdkCall('removeCustomerInfoUpdateListener')).toHaveBeenCalledWith(listener);
  });

  it('reads the management URL', async () => {
    sdkCall('getCustomerInfo').mockResolvedValueOnce(PREMIUM_INFO);
    await expect(
      createRevenueCatSubscriptionAdapter(OPTIONS).managementUrl(),
    ).resolves.toStrictEqual(ok(MANAGEMENT_LINK));
  });
});
