// src/services/purchase/expo-iap-purchase-adapter.ts: PurchasePort over expo-iap, the only file that imports it.
// device-only: covered by check-purchase-behaviour.mjs (a scripted expo-iap) and the StoreKit harness
// Banned here and everywhere (lint and check-purchases): kitApi, KitApiError,
// verifyPurchaseWithProvider, verifyPurchase (a server), useIAP and auto-finishing (hidden finishing).
import {
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
} from 'expo-iap';

import { attemptAsync } from '@/core/result';

import type {
  PurchaseEvent,
  PurchaseFailure,
  PurchasePort,
  StoreFailure,
  StoreProduct,
  StoreResult,
  StoreTransaction,
} from './purchase-port';
import type { Purchase } from 'expo-iap';

/** expo-iap's ErrorCode values -> what the paywall shows; anything else is 'failed'. */
const FAILURES: Partial<Record<string, PurchaseFailure>> = {
  [ErrorCode.UserCancelled]: 'cancelled',
  [ErrorCode.DeferredPayment]: 'deferred',
  [ErrorCode.Pending]: 'deferred',
  [ErrorCode.AlreadyOwned]: 'already-owned',
  [ErrorCode.NetworkError]: 'unavailable',
  [ErrorCode.ServiceError]: 'unavailable',
  [ErrorCode.ServiceDisconnected]: 'unavailable',
  [ErrorCode.ServiceTimeout]: 'unavailable',
  [ErrorCode.BillingUnavailable]: 'unavailable',
  [ErrorCode.IapNotAvailable]: 'unavailable',
  [ErrorCode.InitConnection]: 'unavailable',
  [ErrorCode.ConnectionClosed]: 'unavailable',
  [ErrorCode.NotPrepared]: 'unavailable',
};

/** The SDK's error code, or 'unknown' for an error without one. */
function codeOf(error: unknown): string {
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null;
  return typeof code === 'string' ? code : 'unknown';
}

function storeFailure(error: unknown): StoreFailure {
  return { kind: 'store-error', code: codeOf(error) };
}

function failureEvent(error: unknown): PurchaseEvent {
  const code = codeOf(error);
  return { type: 'failure', failure: FAILURES[code] ?? 'failed', code };
}

function toTransaction(purchase: Purchase): StoreTransaction | null {
  if (purchase.purchaseState === 'unknown') return null;
  const revoked = 'revocationDateIOS' in purchase ? purchase.revocationDateIOS : null;
  // Android: Play Billing holds it unacknowledged (Google refunds it after 3 days).
  const isUnacknowledged =
    'isAcknowledgedAndroid' in purchase && purchase.isAcknowledgedAndroid === false;
  return {
    productId: purchase.productId,
    transactionId: purchase.transactionId ?? purchase.id,
    state: purchase.purchaseState,
    revocationDateMs: revoked ?? null,
    handle: purchase,
    ...(isUnacknowledged ? { isUnfinished: true } : {}),
  };
}

type Emitter = {
  readonly emit: (event: PurchaseEvent) => void;
  readonly subscribe: PurchasePort['subscribe'];
};

function createEmitter(): Emitter {
  const listeners = new Set<(event: PurchaseEvent) => void>();
  const emit = (event: PurchaseEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const subscribe: PurchasePort['subscribe'] = (listener) => {
    listeners.add(listener);
    const updated = purchaseUpdatedListener((purchase) => {
      const transaction = toTransaction(purchase);
      if (transaction !== null) listener({ type: 'transaction', transaction });
    });
    const failed = purchaseErrorListener((error) => {
      listener(failureEvent(error));
    });
    return () => {
      listeners.delete(listener);
      updated.remove();
      failed.remove();
    };
  };
  return { emit, subscribe };
}

function fetchProduct(productId: string): Promise<StoreResult<StoreProduct | null>> {
  return attemptAsync(async () => {
    const products = (await fetchProducts({ skus: [productId], type: 'in-app' })) ?? [];
    const product = products.find((item) => item.id === productId);
    if (product === undefined) return null; // StoreKit returns [] instead of throwing
    const { displayPrice, currency } = product;
    return { productId, displayPrice, currency, price: product.price ?? null };
  }, storeFailure);
}

/** iOS: AppStore.sync(); it throws ErrorCode.SyncError on a failure or a cancelled prompt. */
function restore(): Promise<StoreResult<void>> {
  return attemptAsync(async () => {
    await restorePurchases();
  }, storeFailure);
}

function readTransactions(): Promise<StoreResult<readonly StoreTransaction[]>> {
  return attemptAsync(async () => {
    // false = Transaction.all, which still holds refunded purchases (revocation evidence).
    const purchases = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: false });
    return purchases.map(toTransaction).filter((tx) => tx !== null);
  }, storeFailure);
}

/** The device adapter; the composition root creates it once, inside withConnectivity(...). */
export function createExpoIapPurchaseAdapter(): PurchasePort {
  const { emit, subscribe } = createEmitter();
  return {
    connect: () => attemptAsync(() => initConnection(), storeFailure),
    fetchProduct,
    requestPurchase: async (productId) => {
      try {
        await requestPurchase({
          request: { apple: { sku: productId }, google: { skus: [productId] } },
          type: 'in-app',
        });
      } catch (error) {
        emit(failureEvent(error)); // may repeat purchaseErrorListener: the paywall ignores repeats
      }
    },
    finish: (transaction) =>
      attemptAsync(
        () => finishTransaction({ purchase: transaction.handle as Purchase, isConsumable: false }),
        storeFailure,
      ),
    restore,
    readTransactions,
    subscribe,
  };
}
