// src/stores/premium/open-purchase-stores.ts: creates the premium store and the paywall store, once per app start.
// The one caller of both factories (state-management-zustand's created-once rule): the composition
// root calls it in a useState initializer after the data layer opened, and tests call it over fakes.
import { createPaywallStore } from '@/stores/paywall/paywall-store';
import { createPremiumStore } from '@/stores/premium/premium-store';

import type { PaywallStore } from '@/stores/paywall/paywall-store';
import type { PremiumStore, PremiumStoreDeps } from '@/stores/premium/premium-store';

export type PurchaseStores = {
  readonly premium: PremiumStore;
  readonly paywall: PaywallStore;
};

/** The saved entitlement (hydrated synchronously) and a fresh, memory-only paywall flow. */
export function openPurchaseStores(deps: PremiumStoreDeps): PurchaseStores {
  return { premium: createPremiumStore(deps), paywall: createPaywallStore() };
}
