// src/stores/paywall/paywall-store.ts: the paywall's purchase flow, created once per app start.
// memory-only: the flow is re-read from the store at every launch; the entitlement lives in the premium store.
import { createContext, use } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { paywallReducer } from '@/stores/paywall/paywall-reducer';
import { INITIAL_PAYWALL_STATE } from '@/stores/paywall/paywall-state';

import type { PaywallAction, PaywallState } from '@/stores/paywall/paywall-state';
import type { StoreApi } from 'zustand/vanilla';

export type PaywallStoreState = PaywallState & {
  /** The purchase service and the paywall's notices move the flow; every change goes through the reducer. */
  readonly dispatch: (action: PaywallAction) => void;
};

export type PaywallStore = StoreApi<PaywallStoreState>;

/** openPurchaseStores calls it, once per app start; never module code. */
export function createPaywallStore(): PaywallStore {
  return createStore<PaywallStoreState>()((set, get) => ({
    ...INITIAL_PAYWALL_STATE,
    dispatch: (action) => {
      set(paywallReducer(get(), action));
    },
  }));
}

/** Filled by PurchaseStoresProvider (purchase-stores-context.tsx); null outside it. */
export const PaywallStoreContext = createContext<PaywallStore | null>(null);

/** The store itself, for code that reads at call time (getState) or subscribes outside render. */
export function usePaywallStoreApi(): PaywallStore {
  const store = use(PaywallStoreContext);
  if (store === null)
    throw new Error('usePaywallStore() needs a <PurchaseStoresProvider> above it');
  return store;
}

/** Primitives and state references only; a built value goes through useShallow. */
export function usePaywallStore<TSlice>(selector: (state: PaywallStoreState) => TSlice): TSlice {
  return useStore(usePaywallStoreApi(), selector);
}
