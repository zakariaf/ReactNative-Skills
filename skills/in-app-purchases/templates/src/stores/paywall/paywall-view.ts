// src/stores/paywall/paywall-view.ts: one value per paywall state the screen must design and test.
import type { PaywallFlowKind, PaywallState } from './paywall-state';

export type PaywallView =
  | 'loading-price' // BUY busy, the rest readable
  | 'store-unavailable' // "Connect to the internet to buy or restore."; BUY disabled
  | 'ready' // price, BUY, Restore
  | 'purchase-in-progress' // buttons locked, busy
  | 'pending' // "Waiting for approval"
  | 'success' // the thank-you, then 'already-owned'
  | 'error' // "The purchase couldn't be completed. You were not charged." + Try again
  | 'save-failed' // paid, not saved on this device yet: it is applied at the next start; Restore retries
  | 'already-owned' // "Premium is active" + Restore
  | 'restoring' // the page + the restoring notice
  | 'restore-empty' // the page + "nothing to restore"
  | 'restore-failed'; // the page + "couldn't restore"
// A cancelled purchase has no view of its own: it returns quietly to 'ready'.

const FLOW_VIEW: Readonly<Record<PaywallFlowKind, PaywallView>> = {
  loading: 'loading-price',
  unavailable: 'store-unavailable',
  ready: 'ready',
  purchasing: 'purchase-in-progress',
  pending: 'pending',
  failed: 'error',
  unsaved: 'save-failed',
  restoring: 'restoring',
  'restore-empty': 'restore-empty',
  'restore-failed': 'restore-failed',
};

/** `isPremium` comes from the premium store (selectIsPremium): the one saved truth. */
export function paywallView(state: PaywallState, isPremium: boolean): PaywallView {
  if (isPremium) return state.didJustPurchase ? 'success' : 'already-owned';
  return FLOW_VIEW[state.flow.kind];
}
