// src/services/purchase/fake-purchase.ts: a scripted PurchasePort for Jest; it records every call in order.
import { err, ok } from '@/core/result';

import type {
  PurchaseEvent,
  PurchasePort,
  StoreProduct,
  StoreResult,
  StoreTransaction,
} from './purchase-port';

/** What the fake store answers; tests change it between steps. `calls` collects the call log. */
export type FakePurchaseScript = {
  isConnected: boolean;
  product: StoreProduct | null;
  /** 'sync-failed': restore() answers a store error (a cancelled prompt, offline). */
  restoreResult: 'synced' | 'sync-failed';
  transactions: StoreTransaction[];
  /** readTransactions() answers a store error. */
  readFails?: boolean;
  /** finish() answers a store error. */
  finishFails?: boolean;
  readonly calls: string[];
};

const FAILED = { kind: 'store-error', code: 'unknown' } as const;

export type FakePurchase = PurchasePort & {
  /** Delivers a listener event, as StoreKit or Play Billing would. */
  readonly emit: (event: PurchaseEvent) => void;
  /** How many listeners are subscribed right now (proves that a consumer cleaned up). */
  readonly listenerCount: () => number;
};

/** A store that answers from `script` and logs `connect`, `finish:<id>`, `restore`, ... */
export function createFakePurchase(script: FakePurchaseScript): FakePurchase {
  const listeners = new Set<(event: PurchaseEvent) => void>();
  const call = <TValue>(name: string, value: StoreResult<TValue>): Promise<StoreResult<TValue>> => {
    script.calls.push(name);
    return Promise.resolve(value);
  };
  return {
    connect: () => call('connect', ok(script.isConnected)),
    fetchProduct: () => call('fetchProduct', ok(script.product)),
    requestPurchase: () => {
      script.calls.push('requestPurchase');
      return Promise.resolve();
    },
    finish: (tx) =>
      call(`finish:${tx.transactionId}`, script.finishFails === true ? err(FAILED) : ok(undefined)),
    restore: () => call('restore', script.restoreResult === 'synced' ? ok(undefined) : err(FAILED)),
    readTransactions: () =>
      call(
        'readTransactions',
        script.readFails === true
          ? err(FAILED)
          : ok<readonly StoreTransaction[]>(script.transactions),
      ),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}
