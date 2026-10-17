// src/stores/premium/premium-reducer.ts: the saved Premium entitlement as a pure reducer (the premium store publishes it).
import type { PremiumEntitlement } from '@/data/entitlements/entitlement-repository';

export type PremiumState = {
  readonly entitlement: PremiumEntitlement;
};

export type PremiumAction =
  /** Hydration and reload: what is on disk. */
  | { readonly type: 'replace-entitlement'; readonly entitlement: PremiumEntitlement }
  /** A verified purchase (or restore) was found; `atMs` is the device clock's now. */
  | { readonly type: 'grant-premium'; readonly atMs: number }
  /** A verified revocation; `revokedAtMs` is the store's revocation date. */
  | { readonly type: 'revoke-premium'; readonly revokedAtMs: number };

/** Before the first read: not owned. */
export const DEFAULT_PREMIUM_STATE: PremiumState = {
  entitlement: { isOwned: false, ownedSinceMs: null, revokedAtMs: null },
};

function isSameEntitlement(first: PremiumEntitlement, second: PremiumEntitlement): boolean {
  return (
    first.isOwned === second.isOwned &&
    first.ownedSinceMs === second.ownedSinceMs &&
    first.revokedAtMs === second.revokedAtMs
  );
}

function grant(state: PremiumState, atMs: number): PremiumState {
  const { entitlement } = state;
  // Already owned and never refunded since: no write, no render (re-checks repeat this often).
  if (entitlement.isOwned && entitlement.revokedAtMs === null) return state;
  return {
    entitlement: {
      isOwned: true,
      ownedSinceMs: entitlement.isOwned ? (entitlement.ownedSinceMs ?? atMs) : atMs,
      revokedAtMs: null, // a purchase clears an old refund date
    },
  };
}

function revoke(state: PremiumState, revokedAtMs: number): PremiumState {
  // A revoke without a real date is not evidence: Premium stays (absence is never a refund).
  if (!Number.isSafeInteger(revokedAtMs) || revokedAtMs <= 0) return state;
  const { entitlement } = state;
  if (!entitlement.isOwned && entitlement.revokedAtMs === revokedAtMs) return state;
  return { entitlement: { ...entitlement, isOwned: false, revokedAtMs } };
}

/** Pure: the same object back when nothing changes, so the store writes and renders nothing. */
export function premiumReducer(state: PremiumState, action: PremiumAction): PremiumState {
  switch (action.type) {
    case 'replace-entitlement':
      return isSameEntitlement(state.entitlement, action.entitlement)
        ? state
        : { entitlement: action.entitlement };
    case 'grant-premium':
      return grant(state, action.atMs);
    case 'revoke-premium':
      return revoke(state, action.revokedAtMs);
  }
}
