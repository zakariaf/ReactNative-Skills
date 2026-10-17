// src/services/purchase/fake-purchase.ts — EXAMPLE (a shape to imitate): a fake is a small, real
// implementation of the port, not a bag of jest.fn(). Its script is mutable on purpose (a test
// changes the answer between steps), every failure the store can produce is a script value (no
// product, a failed restore sync, a lost connection), it records every call in an ordered log other
// fakes and stubs share, and it lets the test push the events a store would send.
import type {
  PurchaseEvent,
  PurchasePort,
  RestoreResult,
  StoreProduct,
  StoreTransaction,
} from './purchase-port';

export type FakePurchaseScript = {
  /** false: the store cannot be reached (connect answers false). */
  isConnected: boolean;
  /** null: the store lists no product (a wrong id, or the product is not approved yet). */
  product: StoreProduct | null;
  /** 'synced', or 'sync-failed' when the store could not be asked (offline, signed out). */
  restoreResult: RestoreResult;
  /** What the store holds now, finished or not; the launch re-check and restore read it. */
  transactions: StoreTransaction[];
  /** Shared, ordered: 'fetchProduct', 'requestPurchase', 'finish:<transactionId>', ... */
  readonly calls: string[];
};

export type FakePurchase = PurchasePort & {
  /** Delivers a store event to every listener, as the native store would. */
  readonly emit: (event: PurchaseEvent) => void;
};

export function createFakePurchase(script: FakePurchaseScript): FakePurchase {
  const listeners = new Set<(event: PurchaseEvent) => void>();
  const record = (name: string): void => {
    script.calls.push(name);
  };
  return {
    connect: () => {
      record('connect');
      return Promise.resolve(script.isConnected);
    },
    fetchProduct: () => {
      record('fetchProduct');
      return Promise.resolve(script.product);
    },
    requestPurchase: () => {
      record('requestPurchase');
      return Promise.resolve();
    },
    finishTransaction: (transaction) => {
      record(`finish:${transaction.transactionId}`);
      return Promise.resolve();
    },
    restore: () => {
      record('restore');
      return Promise.resolve(script.restoreResult);
    },
    pendingTransactions: () => {
      record('pendingTransactions');
      return Promise.resolve([...script.transactions]);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
  };
}
