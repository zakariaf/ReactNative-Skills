// src/stores/paywall/paywall-reducer-cases.ts
// The paywall flow rules as data: paywall-reducer.test.ts runs every case, and so does
// state-management-zustand's check-reducers. Plain data and type imports only.
import type { PaywallAction, PaywallFlow, PaywallState } from './paywall-state';
import type { Evidence } from '@/services/purchase/entitlement-evidence';
import type { PurchaseFailure } from '@/services/purchase/purchase-port';

type PaywallCase = {
  readonly rule: string;
  readonly state?: PaywallState;
  readonly action: PaywallAction;
} & ({ readonly same: true } | { readonly expect: Partial<PaywallState> });

type PaywallReducerCases = {
  readonly reducer: 'paywallReducer';
  readonly initial: PaywallState;
  readonly cases: readonly PaywallCase[];
};

/** The formatted store price the service hands over (any string: the reducer never reads it). */
const PRICE = 'store-price-text';
const READY_FLOW: PaywallFlow = { kind: 'ready', price: PRICE };
const LOADING: PaywallState = {
  flow: { kind: 'loading' },
  didJustPurchase: false,
  didJustRestore: false,
};
const at = (flow: PaywallFlow): PaywallState => ({ ...LOADING, flow });
const READY = at(READY_FLOW);
const BUYING = at({ kind: 'purchasing', price: PRICE });
const PENDING = at({ kind: 'pending', price: PRICE });
const RESTORING = at({ kind: 'restoring', price: PRICE });
const UNAVAILABLE = at({ kind: 'unavailable' });

const fail = (failure: PurchaseFailure): PaywallAction => ({
  type: 'record-purchase-failure',
  failure,
});
const restored = (evidence: Evidence | 'sync-failed', isPremium: boolean): PaywallAction => ({
  type: 'finish-restore',
  evidence,
  isPremium,
});
const buy = (isPremium: boolean): PaywallAction => ({ type: 'start-purchase', isPremium });
const FINISH: PaywallAction = { type: 'finish-purchase' };

export const PAYWALL_REDUCER_CASES: PaywallReducerCases = {
  reducer: 'paywallReducer',
  initial: LOADING,
  cases: [
    {
      rule: 'price-makes-the-page-ready',
      action: { type: 'set-price', price: PRICE },
      expect: { flow: READY_FLOW },
    },
    {
      rule: 'a-late-price-after-unavailable-is-ignored',
      state: UNAVAILABLE,
      action: { type: 'set-price', price: PRICE },
      same: true,
    },
    { rule: 'buy-starts-the-purchase', state: READY, action: buy(false), expect: BUYING },
    { rule: 'buy-is-ignored-when-premium', state: READY, action: buy(true), same: true },
    { rule: 'buy-is-ignored-without-a-price', state: UNAVAILABLE, action: buy(false), same: true },
    { rule: 'cancel-returns-quietly', state: BUYING, action: fail('cancelled'), expect: READY },
    { rule: 'deferred-is-pending', state: BUYING, action: fail('deferred'), expect: PENDING },
    { rule: 'a-repeated-failure-is-ignored', state: PENDING, action: fail('failed'), same: true },
    {
      rule: 'thank-you-after-a-purchase',
      state: BUYING,
      action: FINISH,
      expect: { didJustPurchase: true, flow: READY_FLOW },
    },
    {
      rule: 'thank-you-after-an-approved-pending-purchase',
      state: PENDING,
      action: FINISH,
      expect: { didJustPurchase: true },
    },
    { rule: 'no-thank-you-for-a-launch-delivery', state: READY, action: FINISH, same: true },
    {
      rule: 'an-unsaved-purchase-is-shown-as-such',
      state: BUYING,
      action: { type: 'record-save-failure' },
      expect: { didJustPurchase: false, flow: { kind: 'unsaved', price: PRICE } },
    },
    {
      rule: 'failed-sync-is-restore-failed',
      state: RESTORING,
      action: restored('sync-failed', false),
      expect: { flow: { kind: 'restore-failed', price: PRICE } },
    },
    {
      rule: 'good-sync-without-evidence-is-restore-empty',
      state: RESTORING,
      action: restored('unknown', false),
      expect: { flow: { kind: 'restore-empty', price: PRICE } },
    },
    {
      rule: 'restore-empty-never-shows-for-an-owner',
      state: RESTORING,
      action: restored('unknown', true),
      expect: { flow: READY_FLOW },
    },
    {
      rule: 'a-restore-shows-restored-not-thank-you',
      state: { ...RESTORING, didJustPurchase: true },
      action: restored('owned', true),
      expect: { didJustPurchase: false, didJustRestore: true },
    },
    {
      rule: 'clear-thanks-when-none-is-a-no-op',
      state: READY,
      action: { type: 'clear-thanks' },
      same: true,
    },
  ],
};
