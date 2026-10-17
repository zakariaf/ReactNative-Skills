// src/stores/premium/premium-store.ts: the Premium entitlement store: thin, hydrated once, every change saved before it is shown.
import { createContext, use } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { ok } from '@/core/result';
import { NOT_OWNED } from '@/data/entitlements/entitlement-repository';
import { DEFAULT_PREMIUM_STATE, premiumReducer } from '@/stores/premium/premium-reducer';

import type { Result } from '@/core/result';
import type {
  EntitlementFailure,
  EntitlementRepository,
  PremiumEntitlement,
} from '@/data/entitlements/entitlement-repository';
import type { PremiumState } from '@/stores/premium/premium-reducer';
import type { StoreApi } from 'zustand/vanilla';

/** A verified purchase or restore: when this device saw it (the clock's now). */
export type PremiumGrant = { readonly ownedSinceMs: number };

export type PremiumStoreState = PremiumState & {
  /**
   * Saves Premium, then shows it. Only the purchase service calls it (and test-only debug code).
   * ok without a write when already owned. A failed save shows nothing: the purchase flow then
   * leaves the store transaction unfinished, so the store delivers it again.
   */
  readonly grantPremium: (grant: PremiumGrant) => Result<void, EntitlementFailure>;
  /** Saves a dated revocation, then shows it; a revoke without a date changes nothing. */
  readonly revokePremium: (revokedAtMs: number) => Result<void, EntitlementFailure>;
  /** Re-reads the entitlement from disk (after an import or a cross-store write). */
  readonly reload: () => Result<void, EntitlementFailure>;
};

export type PremiumStore = StoreApi<PremiumStoreState>;

/** What the store reads and writes through: the entitlements repository (on AppData). */
export type PremiumStoreDeps = {
  readonly entitlements: Pick<EntitlementRepository, 'premium' | 'savePremium'>;
};

/** The saved entitlement; a failed read starts as not owned (the launch re-check restores it). */
function readEntitlement(entitlements: PremiumStoreDeps['entitlements']): PremiumEntitlement {
  const read = entitlements.premium();
  return read.ok ? read.value : NOT_OWNED;
}

/** openPurchaseStores calls it, once per app start; never module code. */
export function createPremiumStore({ entitlements }: PremiumStoreDeps): PremiumStore {
  return createStore<PremiumStoreState>()((set, get) => ({
    ...premiumReducer(DEFAULT_PREMIUM_STATE, {
      type: 'replace-entitlement',
      entitlement: readEntitlement(entitlements),
    }),
    grantPremium: ({ ownedSinceMs }) => {
      const current = get();
      const next = premiumReducer(current, { type: 'grant-premium', atMs: ownedSinceMs });
      if (next === current) return ok(undefined);
      // 1. Persist: committed when it returns ok. 2. Publish what was saved.
      const saved = entitlements.savePremium(next.entitlement);
      if (!saved.ok) return saved;
      set(next);
      return saved;
    },
    revokePremium: (revokedAtMs) => {
      const current = get();
      const next = premiumReducer(current, { type: 'revoke-premium', revokedAtMs });
      if (next === current) return ok(undefined);
      const saved = entitlements.savePremium(next.entitlement);
      if (!saved.ok) return saved;
      set(next);
      return saved;
    },
    reload: () => {
      const read = entitlements.premium();
      if (!read.ok) return read;
      set(premiumReducer(get(), { type: 'replace-entitlement', entitlement: read.value }));
      return ok(undefined);
    },
  }));
}

/** Filled by PurchaseStoresProvider (purchase-stores-context.tsx); null outside it. */
export const PremiumStoreContext = createContext<PremiumStore | null>(null);

/** The store itself, for code that reads at call time (getState) or subscribes outside render. */
export function usePremiumStoreApi(): PremiumStore {
  const store = use(PremiumStoreContext);
  if (store === null)
    throw new Error('usePremiumStore() needs a <PurchaseStoresProvider> above it');
  return store;
}

/** usePremiumStore(selectIsPremium): ads, the paywall, Settings and perks read this one value. */
export function usePremiumStore<TSlice>(selector: (state: PremiumStoreState) => TSlice): TSlice {
  return useStore(usePremiumStoreApi(), selector);
}
