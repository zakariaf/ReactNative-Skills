// src/stores/paywall/paywall-reducer.ts: the paywall's purchase flow as a pure reducer.
import { priceOf } from './paywall-state';
import {
  onPurchaseFailure,
  onPurchaseFinished,
  onRestoreFinished,
  onStartPurchase,
} from './paywall-transitions';

import type { PaywallAction, PaywallState } from './paywall-state';

/** Pure: the same object back when nothing changes. */
export function paywallReducer(state: PaywallState, action: PaywallAction): PaywallState {
  switch (action.type) {
    case 'start-loading':
      return { ...state, flow: { kind: 'loading' } };
    case 'mark-store-unavailable':
      return { ...state, flow: { kind: 'unavailable' } };
    case 'set-price':
      return state.flow.kind === 'loading'
        ? { ...state, flow: { kind: 'ready', price: action.price } }
        : state;
    case 'start-purchase':
      return onStartPurchase(state, action.isPremium);
    case 'record-purchase-failure':
      return onPurchaseFailure(state, action.failure);
    case 'mark-purchase-pending':
      return state.flow.kind === 'purchasing'
        ? { ...state, flow: { kind: 'pending', price: state.flow.price } }
        : state;
    case 'finish-purchase':
      return onPurchaseFinished(state);
    case 'record-save-failure':
      return {
        ...state,
        didJustPurchase: false,
        flow: { kind: 'unsaved', price: priceOf(state.flow) },
      };
    case 'start-restore':
      return { ...state, flow: { kind: 'restoring', price: priceOf(state.flow) } };
    case 'finish-restore':
      return onRestoreFinished(state, action.evidence, action.isPremium);
    case 'clear-thanks':
      return state.didJustPurchase ? { ...state, didJustPurchase: false } : state;
    case 'clear-restore-notice':
      return state.didJustRestore ? { ...state, didJustRestore: false } : state;
  }
}
