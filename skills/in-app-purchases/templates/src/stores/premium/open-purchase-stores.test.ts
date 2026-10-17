// src/stores/premium/open-purchase-stores.test.ts
import { createFakeEntitlementRepository } from '@/data/entitlements/fake-entitlement-repository';

import { openPurchaseStores } from './open-purchase-stores';
import { selectIsPremium } from './premium-selectors';

describe('openPurchaseStores', () => {
  it('hydrates Premium from disk and starts the paywall loading', () => {
    const entitlements = createFakeEntitlementRepository({
      isOwned: true,
      ownedSinceMs: 1,
      revokedAtMs: null,
    });
    const { premium, paywall } = openPurchaseStores({ entitlements });
    expect(selectIsPremium(premium.getState())).toBe(true);
    expect(paywall.getState().flow).toStrictEqual({ kind: 'loading' });
  });
});
