// src/stores/paywall/paywall-transitions.ts: the paywall's non-trivial transitions, one function each.
import { priceOf, readyOrUnavailable } from './paywall-state';

import type { PaywallState } from './paywall-state';
import type { Evidence } from '@/services/purchase/entitlement-evidence';
import type { PurchaseFailure } from '@/services/purchase/purchase-port';

const CAN_BUY = new Set(['ready', 'failed', 'restore-empty', 'restore-failed']);

/** BUY from a quiet page with a price, never when already Premium. */
export function onStartPurchase(state: PaywallState, isPremium: boolean): PaywallState {
  const price = priceOf(state.flow);
  if (isPremium || price === null || !CAN_BUY.has(state.flow.kind)) return state;
  return { ...state, flow: { kind: 'purchasing', price } };
}

/**
 * Failures count only while a purchase is in flight: iOS reports a failed requestPurchase as a
 * rejected promise AND on purchaseErrorListener, so the repeat is a no-op.
 */
export function onPurchaseFailure(state: PaywallState, failure: PurchaseFailure): PaywallState {
  if (state.flow.kind !== 'purchasing') return state;
  const price = state.flow.price;
  switch (failure) {
    case 'cancelled':
      return { ...state, flow: { kind: 'ready', price } }; // quietly back, no message
    case 'deferred':
      return { ...state, flow: { kind: 'pending', price } };
    case 'already-owned':
      return { ...state, flow: { kind: 'restoring', price } }; // the service runs restore
    case 'unavailable':
      return { ...state, flow: { kind: 'unavailable' } };
    case 'failed':
      return { ...state, flow: { kind: 'failed', price } };
  }
}

/** Premium was saved: the thank-you only when the user was buying (never for a launch delivery). */
export function onPurchaseFinished(state: PaywallState): PaywallState {
  const { flow } = state;
  if (flow.kind !== 'purchasing' && flow.kind !== 'pending') return state;
  return { ...state, didJustPurchase: true, flow: { kind: 'ready', price: flow.price } };
}

/** "Couldn't restore" after any failed sync; "nothing to restore" only after a good one. */
export function onRestoreFinished(
  state: PaywallState,
  evidence: Evidence | 'sync-failed',
  isPremium: boolean,
): PaywallState {
  const price = priceOf(state.flow);
  if (evidence === 'sync-failed') return { ...state, flow: { kind: 'restore-failed', price } };
  if (evidence === 'owned') {
    // A restore is not a purchase: the "restored" notice, never the thank-you.
    const flow = readyOrUnavailable(price);
    return { ...state, didJustPurchase: false, didJustRestore: true, flow };
  }
  if (evidence === 'revoked' || isPremium) return { ...state, flow: readyOrUnavailable(price) };
  return { ...state, flow: { kind: 'restore-empty', price } };
}
