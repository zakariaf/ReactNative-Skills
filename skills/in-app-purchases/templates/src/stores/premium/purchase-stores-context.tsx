// src/stores/premium/purchase-stores-context.tsx
// Hands the premium store and the paywall store down from the composition root. Both are created
// once per app start (the root's useState initializer, after the data layer opened); the store
// objects never change, so nothing re-renders for the provider itself.
import { PaywallStoreContext } from '@/stores/paywall/paywall-store';

import { PremiumStoreContext } from './premium-store';

import type { PremiumStore } from './premium-store';
import type { PaywallStore } from '@/stores/paywall/paywall-store';
import type { ReactNode } from 'react';

export type PurchaseStoresProviderProps = {
  readonly premium: PremiumStore;
  readonly paywall: PaywallStore;
  readonly children: ReactNode;
};

export function PurchaseStoresProvider({
  premium,
  paywall,
  children,
}: PurchaseStoresProviderProps): ReactNode {
  return (
    <PremiumStoreContext value={premium}>
      <PaywallStoreContext value={paywall}>{children}</PaywallStoreContext>
    </PremiumStoreContext>
  );
}
