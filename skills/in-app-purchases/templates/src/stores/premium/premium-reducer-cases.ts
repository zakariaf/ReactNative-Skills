// src/stores/premium/premium-reducer-cases.ts
// The entitlement rules as data: premium-reducer.test.ts runs every case, and so does
// state-management-zustand's check-reducers. Plain data and type imports only, so a checker can
// load it without the app. The table type is written here (the shape of ReducerCases).
import type { PremiumAction, PremiumState } from './premium-reducer';
import type { PremiumEntitlement } from '@/data/entitlements/entitlement-repository';

type PremiumCase = {
  /** The kebab-case name of the rule the case pins; a failure names it. */
  readonly rule: string;
  /** The state before the action; the table's `initial` when left out. */
  readonly state?: PremiumState;
  readonly action: PremiumAction;
} & ({ readonly same: true } | { readonly expect: Partial<PremiumState> });

type PremiumReducerCases = {
  readonly reducer: 'premiumReducer';
  readonly initial: PremiumState;
  readonly cases: readonly PremiumCase[];
};

const OWNED_SINCE_1000: PremiumEntitlement = {
  isOwned: true,
  ownedSinceMs: 1_000,
  revokedAtMs: null,
};
const NEVER_OWNED: PremiumState = {
  entitlement: { isOwned: false, ownedSinceMs: null, revokedAtMs: null },
};
const OWNED: PremiumState = { entitlement: OWNED_SINCE_1000 };
const REFUNDED: PremiumState = {
  entitlement: { isOwned: false, ownedSinceMs: 1_000, revokedAtMs: 5_000 },
};
const GRANT_LATER: PremiumAction = { type: 'grant-premium', atMs: 9_000 };
const REVOKE_AT_5000: PremiumAction = { type: 'revoke-premium', revokedAtMs: 5_000 };
const REPLACE_WITH_OWNED: PremiumAction = {
  type: 'replace-entitlement',
  entitlement: OWNED_SINCE_1000,
};

export const PREMIUM_REDUCER_CASES: PremiumReducerCases = {
  reducer: 'premiumReducer',
  initial: NEVER_OWNED,
  cases: [
    {
      rule: 'grant-turns-premium-on',
      action: { type: 'grant-premium', atMs: 2_000 },
      expect: { entitlement: { isOwned: true, ownedSinceMs: 2_000, revokedAtMs: null } },
    },
    { rule: 'grant-when-owned-is-a-no-op', state: OWNED, action: GRANT_LATER, same: true },
    {
      rule: 'grant-after-refund-clears-the-refund-date',
      state: REFUNDED,
      action: GRANT_LATER,
      expect: { entitlement: { isOwned: true, ownedSinceMs: 9_000, revokedAtMs: null } },
    },
    {
      rule: 'revoke-with-a-date-turns-premium-off',
      state: OWNED,
      action: REVOKE_AT_5000,
      expect: { entitlement: REFUNDED.entitlement },
    },
    {
      rule: 'revoke-without-a-date-keeps-premium',
      state: OWNED,
      action: { type: 'revoke-premium', revokedAtMs: 0 },
      same: true,
    },
    {
      rule: 'the-same-revocation-twice-is-a-no-op',
      state: REFUNDED,
      action: REVOKE_AT_5000,
      same: true,
    },
    {
      rule: 'replace-with-what-is-held-is-a-no-op',
      state: OWNED,
      action: REPLACE_WITH_OWNED,
      same: true,
    },
    {
      rule: 'replace-reads-the-disk',
      action: REPLACE_WITH_OWNED,
      expect: { entitlement: OWNED_SINCE_1000 },
    },
  ],
};
