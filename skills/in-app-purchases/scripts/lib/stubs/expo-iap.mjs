// Scripted stand-in for expo-iap 5.8.0, used only by check-purchase-behaviour.mjs (module-stubs.mjs
// resolves 'expo-iap' to this file) so the app's own purchase adapter runs under Node. It records
// every call with its arguments and lets the checker fire listener events. Not an entry point.
// ErrorCode values are the string values of the 5.8.0 enum (re-read build/types.js on an upgrade).

export const ErrorCode = {
  ActivityUnavailable: 'activity-unavailable',
  AlreadyOwned: 'already-owned',
  AlreadyPrepared: 'already-prepared',
  BillingResponseJsonParseError: 'billing-response-json-parse-error',
  BillingUnavailable: 'billing-unavailable',
  ConnectionClosed: 'connection-closed',
  DeferredPayment: 'deferred-payment',
  DeveloperError: 'developer-error',
  DuplicatePurchase: 'duplicate-purchase',
  EmptySkuList: 'empty-sku-list',
  FeatureNotSupported: 'feature-not-supported',
  IapNotAvailable: 'iap-not-available',
  InitConnection: 'init-connection',
  Interrupted: 'interrupted',
  ItemNotOwned: 'item-not-owned',
  ItemUnavailable: 'item-unavailable',
  NetworkError: 'network-error',
  NotEnded: 'not-ended',
  NotPrepared: 'not-prepared',
  Pending: 'pending',
  PurchaseError: 'purchase-error',
  PurchaseVerificationFailed: 'purchase-verification-failed',
  PurchaseVerificationFinishFailed: 'purchase-verification-finish-failed',
  PurchaseVerificationFinished: 'purchase-verification-finished',
  QueryProduct: 'query-product',
  RemoteError: 'remote-error',
  ServiceDisconnected: 'service-disconnected',
  ServiceError: 'service-error',
  ServiceTimeout: 'service-timeout',
  SkuNotFound: 'sku-not-found',
  SkuOfferMismatch: 'sku-offer-mismatch',
  SyncError: 'sync-error',
  TransactionValidationFailed: 'transaction-validation-failed',
  Unknown: 'unknown',
  UserCancelled: 'user-cancelled',
  UserError: 'user-error',
};

const state = { calls: [], script: {}, updated: new Set(), failed: new Set() };

/** Resolve with the scripted value, or reject when it is an Error (or a { code } failure object). */
function answer(name, args, fallback) {
  state.calls.push(args.length > 0 ? `${name}:${JSON.stringify(args[0])}` : name);
  const value = name in state.script ? state.script[name] : fallback;
  if (value instanceof Error || (typeof value === 'object' && value !== null && 'rejectWith' in value)) {
    return Promise.reject(value instanceof Error ? value : value.rejectWith);
  }
  return Promise.resolve(value);
}

export const iapStub = {
  /** script: { initConnection, fetchProducts, getAvailablePurchases, restorePurchases, requestPurchase, finishTransaction } */
  reset(script = {}) {
    state.calls.length = 0;
    state.script = script;
    state.updated.clear();
    state.failed.clear();
  },
  calls: () => [...state.calls],
  listenerCount: () => state.updated.size + state.failed.size,
  emitPurchase(purchase) {
    for (const listener of [...state.updated]) listener(purchase);
  },
  emitError(error) {
    for (const listener of [...state.failed]) listener(error);
  },
};

export const initConnection = (...args) => answer('initConnection', args, true);
export const endConnection = (...args) => answer('endConnection', args, true);
export const fetchProducts = (...args) => answer('fetchProducts', args, []);
export const getAvailablePurchases = (...args) => answer('getAvailablePurchases', args, []);
export const restorePurchases = (...args) => answer('restorePurchases', args, undefined);
export const requestPurchase = (...args) => answer('requestPurchase', args, null);
export const finishTransaction = (...args) => answer('finishTransaction', args.length > 0 ? [{ ...args[0], purchase: args[0]?.purchase?.transactionId ?? args[0]?.purchase?.id ?? null }] : args, undefined);

export function purchaseUpdatedListener(listener) {
  state.updated.add(listener);
  return { remove: () => state.updated.delete(listener) };
}

export function purchaseErrorListener(listener) {
  state.failed.add(listener);
  return { remove: () => state.failed.delete(listener) };
}
