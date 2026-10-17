// src/services/purchase/premium-store-flow.ts: starting the store, loading the price, buying.
import { ok } from '@/core/result';

import { processPurchaseEvent, recheckPremium } from './premium-service';

import type { PremiumServiceDeps } from './premium-service';
import type { StoreProduct, StoreResult } from './purchase-port';
import type { PaywallFlowKind } from '@/stores/paywall/paywall-state';

/** Pages a connectivity change may reload; never while loading, buying, pending or restoring. */
const QUIET_FLOWS: ReadonlySet<PaywallFlowKind> = new Set<PaywallFlowKind>([
  'ready',
  'failed',
  'restore-empty',
  'restore-failed',
]);

/**
 * ConnectivityPort changed: reload when the device came back online while the paywall says
 * "unavailable", or went offline from a quiet page (the gated port then says "store unavailable").
 */
export function shouldReloadStore(flow: PaywallFlowKind, isOnline: boolean): boolean {
  return isOnline ? flow === 'unavailable' : QUIET_FLOWS.has(flow);
}

/** ok(null) when the store is not reachable or sells no such product. */
async function fetchWhenConnected(
  deps: PremiumServiceDeps,
): Promise<StoreResult<StoreProduct | null>> {
  const connected = await deps.port.connect();
  if (!connected.ok || !connected.value) return connected.ok ? ok(null) : connected;
  return deps.port.fetchProduct(deps.productId);
}

/** connect -> fetch the product (none, or no price text => "store unavailable") -> the price. */
export async function loadStore(deps: PremiumServiceDeps): Promise<void> {
  const { dispatch } = deps.paywall.getState();
  dispatch({ type: 'start-loading' });
  const product = await fetchWhenConnected(deps);
  if (!product.ok) deps.onError(new Error(`store not loaded: ${product.error.code}`));
  const priceText = product.ok && product.value !== null ? deps.formatPrice(product.value) : null;
  if (priceText === null) {
    dispatch({ type: 'mark-store-unavailable' }); // nothing to sell, or no price to show
    return;
  }
  dispatch({ type: 'set-price', price: priceText });
}

/**
 * App start, after the first frame, never awaited by it. Listen FIRST (the store replays
 * unfinished and approved Ask to Buy transactions right after connecting), then load the price,
 * then re-check silently. Returns the unsubscribe.
 */
export async function startPremium(deps: PremiumServiceDeps): Promise<() => void> {
  const unsubscribe = deps.port.subscribe((event) => {
    processPurchaseEvent(deps, event).catch(deps.onError);
  });
  await loadStore(deps);
  await recheckPremium(deps);
  return unsubscribe;
}

/** BUY: asks the store only when the paywall accepted the tap; the outcome arrives via subscribe(). */
export async function buyPremium(deps: PremiumServiceDeps): Promise<void> {
  const isPremium = deps.premium.getState().entitlement.isOwned;
  deps.paywall.getState().dispatch({ type: 'start-purchase', isPremium });
  if (deps.paywall.getState().flow.kind !== 'purchasing') return;
  await deps.port.requestPurchase(deps.productId);
}
