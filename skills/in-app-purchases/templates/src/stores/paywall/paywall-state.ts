// src/stores/paywall/paywall-state.ts: the store flow the paywall shows (memory only: re-read from the store at every launch).
import type { Evidence } from '@/services/purchase/entitlement-evidence';
import type { PurchaseFailure } from '@/services/purchase/purchase-port';

/** Where the purchase flow is. `price` is the formatted store price, kept so the page stays readable. */
export type PaywallFlow =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly price: string }
  | { readonly kind: 'purchasing'; readonly price: string }
  | { readonly kind: 'pending'; readonly price: string }
  | { readonly kind: 'failed'; readonly price: string }
  /** Paid, but this device could not save it: the transaction stays open and is retried. */
  | { readonly kind: 'unsaved'; readonly price: string | null }
  | { readonly kind: 'restoring'; readonly price: string | null }
  | { readonly kind: 'restore-empty'; readonly price: string | null }
  | { readonly kind: 'restore-failed'; readonly price: string | null };

/** The flow's kind alone (what shouldReloadStore and the view table key on). */
export type PaywallFlowKind = PaywallFlow['kind'];

export type PaywallState = {
  readonly flow: PaywallFlow;
  /** One thank-you, only after a purchase or an approved pending one. */
  readonly didJustPurchase: boolean;
  /** One "Purchase restored" notice. */
  readonly didJustRestore: boolean;
};

export type PaywallAction =
  | { readonly type: 'start-loading' }
  | { readonly type: 'mark-store-unavailable' }
  | { readonly type: 'set-price'; readonly price: string }
  /** BUY: refused when already Premium, without a price, or mid-flow. */
  | { readonly type: 'start-purchase'; readonly isPremium: boolean }
  /** Counted only while purchasing: iOS reports one failure twice. */
  | { readonly type: 'record-purchase-failure'; readonly failure: PurchaseFailure }
  | { readonly type: 'mark-purchase-pending' }
  /** Premium was saved for a purchase the store delivered. */
  | { readonly type: 'finish-purchase' }
  /** The store delivered a purchase this device could not save. */
  | { readonly type: 'record-save-failure' }
  | { readonly type: 'start-restore' }
  | {
      readonly type: 'finish-restore';
      readonly evidence: Evidence | 'sync-failed';
      readonly isPremium: boolean;
    }
  | { readonly type: 'clear-thanks' }
  | { readonly type: 'clear-restore-notice' };

export const INITIAL_PAYWALL_STATE: PaywallState = {
  flow: { kind: 'loading' },
  didJustPurchase: false,
  didJustRestore: false,
};

/** The formatted store price the flow carries, or null (loading, unavailable, no price known). */
export function priceOf(flow: PaywallFlow): string | null {
  return 'price' in flow ? flow.price : null;
}

/** The quiet page: ready with a price, unavailable without one. */
export function readyOrUnavailable(price: string | null): PaywallFlow {
  return price === null ? { kind: 'unavailable' } : { kind: 'ready', price };
}
