// src/services/purchase/premium-service.ts: purchases, restores and re-checks, in the order that never loses a paid purchase.
import { entitlementEvidence, isOwnedPurchase, latestRevocationMs } from './entitlement-evidence';

import type { Evidence } from './entitlement-evidence';
import type { PurchaseEvent, PurchasePort, StoreProduct, StoreTransaction } from './purchase-port';
import type { PaywallAction } from '@/stores/paywall/paywall-state';
import type { PaywallStore } from '@/stores/paywall/paywall-store';
import type { PremiumStore } from '@/stores/premium/premium-store';

/** Built once by the composition root from the stores and the services. */
export type PremiumServiceDeps = {
  /** withConnectivity(createExpoIapPurchaseAdapter(), connectivity.isOnline) */
  readonly port: PurchasePort;
  /** The product id (src/config/purchase-products.ts). */
  readonly productId: string;
  /** The saved entitlement: grantPremium/revokePremium write before they publish. */
  readonly premium: Pick<PremiumStore, 'getState'>;
  /** The paywall's memory-only flow. */
  readonly paywall: Pick<PaywallStore, 'getState'>;
  /** ClockPort.nowMs: when this device saved the purchase. */
  readonly nowMs: () => number;
  /**
   * storePriceText (the store's own displayPrice; null = no price to show). An app whose digits
   * follow an in-app setting passes value-objects-money-and-units' formatMoney of the store Money.
   */
  readonly formatPrice: (product: StoreProduct) => string | null;
  /** (error) => errorLog.record('service', error) */
  readonly onError: (error: unknown) => void;
};

/** What a read of the transactions proved, whether an owned Premium is on disk, what waits for finish(). */
type Applied = {
  readonly evidence: Evidence;
  readonly isSaved: boolean;
  readonly unfinished: readonly StoreTransaction[];
};

function dispatch(deps: PremiumServiceDeps, action: PaywallAction): void {
  deps.paywall.getState().dispatch(action);
}

/** Saves Premium; false (the failure logged) when it did not reach the disk. */
function grant(deps: PremiumServiceDeps): boolean {
  const granted = deps.premium.getState().grantPremium({ ownedSinceMs: deps.nowMs() });
  if (!granted.ok) deps.onError(new Error(`premium not saved: ${granted.error.kind}`));
  return granted.ok;
}

/** Saves explicit evidence only ('unknown' changes nothing) and returns it. */
function applyEvidence(
  deps: PremiumServiceDeps,
  transactions: readonly StoreTransaction[],
): Applied {
  const evidence = entitlementEvidence(transactions, deps.productId);
  if (evidence === 'revoked') {
    const revoked = deps.premium
      .getState()
      .revokePremium(latestRevocationMs(transactions, deps.productId));
    if (!revoked.ok) deps.onError(new Error(`revocation not saved: ${revoked.error.kind}`));
    dispatch(deps, { type: 'clear-thanks' });
  }
  if (evidence !== 'owned') return { evidence, isSaved: false, unfinished: [] };
  const isSaved = grant(deps);
  // Android: a purchase left unacknowledged (its save failed) is never delivered again and Google
  // refunds it after 3 days: finish it here, but only once its Premium is on disk.
  const unfinished = isSaved
    ? transactions.filter((tx) => tx.isUnfinished === true && isOwnedPurchase(tx, deps.productId))
    : [];
  return { evidence, isSaved, unfinished };
}

async function finishQuietly(deps: PremiumServiceDeps, tx: StoreTransaction): Promise<void> {
  const finished = await deps.port.finish(tx);
  // An unfinished transaction is delivered again at the next launch: log it and move on.
  if (!finished.ok) deps.onError(new Error(`finish failed: ${finished.error.code}`));
}

async function finishAll(
  deps: PremiumServiceDeps,
  transactions: readonly StoreTransaction[],
): Promise<void> {
  for (const tx of transactions) await finishQuietly(deps, tx);
}

/** Launch, foreground, reconnect and after a revocation event. Errors keep the saved state. */
export async function recheckPremium(deps: PremiumServiceDeps): Promise<void> {
  const read = await deps.port.readTransactions();
  if (!read.ok) {
    deps.onError(new Error(`transactions not read: ${read.error.code}`));
    return;
  }
  const { unfinished } = applyEvidence(deps, read.value);
  await finishAll(deps, unfinished);
}

/** A delivered transaction: save -> show -> finish, never another order. */
export async function processTransaction(
  deps: PremiumServiceDeps,
  tx: StoreTransaction,
): Promise<void> {
  if (tx.productId !== deps.productId) return;
  if (tx.state === 'pending') {
    dispatch(deps, { type: 'mark-purchase-pending' });
    return;
  }
  if (tx.revocationDateMs !== null) {
    await recheckPremium(deps); // a newer, valid purchase still wins
    await finishQuietly(deps, tx);
    return;
  }
  // 1. The entitlement is saved (synchronously) and shown everywhere at once ...
  if (!grant(deps)) {
    // ... or not: the transaction stays unfinished, so the store delivers it again at the next
    // launch (Android: the next re-check finishes it once the save works).
    dispatch(deps, { type: 'record-save-failure' });
    return;
  }
  dispatch(deps, { type: 'finish-purchase' }); // 2. the paywall's thank-you ...
  await finishQuietly(deps, tx); // 3. ... and only then may the store forget the transaction.
}

/** What a restore found, or 'sync-failed' with nothing saved and nothing to finish. */
type Restored = {
  readonly evidence: Evidence | 'sync-failed';
  readonly isSaved: boolean;
  readonly unfinished: readonly StoreTransaction[];
};

const NOT_SYNCED: Restored = { evidence: 'sync-failed', isSaved: false, unfinished: [] };

async function syncAndReadEvidence(deps: PremiumServiceDeps): Promise<Restored> {
  const synced = await deps.port.restore();
  if (!synced.ok) return NOT_SYNCED; // a cancelled prompt or offline: never "nothing to restore"
  const read = await deps.port.readTransactions();
  if (!read.ok) {
    deps.onError(new Error(`transactions not read: ${read.error.code}`));
    return NOT_SYNCED;
  }
  return applyEvidence(deps, read.value);
}

/** "Restore purchase" (paywall and Settings): sync with the store, then read the verified transactions. */
export async function restorePremium(deps: PremiumServiceDeps): Promise<void> {
  dispatch(deps, { type: 'start-restore' });
  const { evidence, isSaved, unfinished } = await syncAndReadEvidence(deps);
  if (evidence === 'owned' && !isSaved) {
    dispatch(deps, { type: 'record-save-failure' });
    return;
  }
  const isPremium = deps.premium.getState().entitlement.isOwned;
  dispatch(deps, { type: 'finish-restore', evidence, isPremium });
  await finishAll(deps, unfinished);
}

/** Every listener event; "already owned" runs a restore. */
export async function processPurchaseEvent(
  deps: PremiumServiceDeps,
  event: PurchaseEvent,
): Promise<void> {
  if (event.type === 'transaction') {
    await processTransaction(deps, event.transaction);
    return;
  }
  dispatch(deps, { type: 'record-purchase-failure', failure: event.failure });
  if (event.failure === 'already-owned') await restorePremium(deps);
}
