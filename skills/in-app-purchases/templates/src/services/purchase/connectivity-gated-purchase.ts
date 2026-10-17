// src/services/purchase/connectivity-gated-purchase.ts: the store follows ConnectivityPort.
// While offline (a real outage, or a test build's simulated-offline switch) the store reports itself
// unavailable without asking StoreKit or Play Billing: the paywall shows "store unavailable" at once
// and a restore ends in "couldn't restore". Only isOnline() decides: Android's 'unvalidated'
// reachability can still reach the store, so it never blocks a purchase.
import { err, ok } from '@/core/result';

import type { PurchasePort, StoreTransaction } from './purchase-port';

/** Absence is never evidence: an offline re-check changes nothing (the saved Premium stays). */
const NO_TRANSACTIONS: readonly StoreTransaction[] = [];
const OFFLINE = { kind: 'store-error', code: 'offline' } as const;

/** Wraps the device adapter where the composition root creates it: withConnectivity(adapter, connectivity.isOnline). */
export function withConnectivity(port: PurchasePort, isOnline: () => boolean): PurchasePort {
  return {
    ...port,
    connect: () => (isOnline() ? port.connect() : Promise.resolve(ok(false))),
    fetchProduct: (productId) =>
      isOnline() ? port.fetchProduct(productId) : Promise.resolve(ok(null)),
    restore: () => (isOnline() ? port.restore() : Promise.resolve(err(OFFLINE))),
    readTransactions: () =>
      isOnline() ? port.readTransactions() : Promise.resolve(ok(NO_TRANSACTIONS)),
  };
}
