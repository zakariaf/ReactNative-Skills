// test/purchase/create-premium-test-deps.ts: the purchase service over the real stores, a fake store and a fake disk.
import { createFakeEntitlementRepository } from '@/data/entitlements/fake-entitlement-repository';
import { createFakePurchase } from '@/services/purchase/fake-purchase';
import { storePriceText } from '@/services/purchase/store-price-text';
import { openPurchaseStores } from '@/stores/premium/open-purchase-stores';

import type { FakeEntitlementRepository } from '@/data/entitlements/fake-entitlement-repository';
import type { FakePurchase, FakePurchaseScript } from '@/services/purchase/fake-purchase';
import type { PremiumServiceDeps } from '@/services/purchase/premium-service';
import type { StoreTransaction } from '@/services/purchase/purchase-port';
import type { PaywallStore } from '@/stores/paywall/paywall-store';
import type { PremiumStore } from '@/stores/premium/premium-store';

export const TEST_PRODUCT_ID = 'com.example.tasks.premium';

/** A verified, unrefunded purchase of the test product. */
export const BOUGHT: StoreTransaction = {
  productId: TEST_PRODUCT_ID,
  transactionId: 't1',
  state: 'purchased',
  revocationDateMs: null,
  handle: null,
};

export type PremiumTestDeps = {
  readonly deps: PremiumServiceDeps;
  readonly script: FakePurchaseScript;
  readonly port: FakePurchase;
  readonly entitlements: FakeEntitlementRepository;
  readonly premium: PremiumStore;
  readonly paywall: PaywallStore;
  /** Every error the service reported, in order. */
  readonly errors: unknown[];
};

/** A connected store selling the test product at $2.99; `script` overrides any answer. */
export function createPremiumTestDeps(script: Partial<FakePurchaseScript> = {}): PremiumTestDeps {
  const full: FakePurchaseScript = {
    isConnected: true,
    product: { productId: TEST_PRODUCT_ID, displayPrice: '$2.99', price: 2.99, currency: 'USD' },
    restoreResult: 'synced',
    transactions: [],
    calls: [],
    ...script,
  };
  const port = createFakePurchase(full);
  const entitlements = createFakeEntitlementRepository();
  const { premium, paywall } = openPurchaseStores({ entitlements });
  const errors: unknown[] = [];
  const deps: PremiumServiceDeps = {
    port,
    productId: TEST_PRODUCT_ID,
    premium,
    paywall,
    nowMs: () => 1_000,
    formatPrice: storePriceText,
    onError: (error) => {
      errors.push(error);
    },
  };
  return { deps, script: full, port, entitlements, premium, paywall, errors };
}
