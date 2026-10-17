// src/services/purchase/purchase-port.ts: the app's whole view of the store (App Store and Google Play), as a port.
import type { Result } from '@/core/result';

/** One product as the store sells it in the user's storefront. */
export type StoreProduct = {
  readonly productId: string;
  /** The store's own formatted price, the text the purchase sheet shows: the price the paywall shows. */
  readonly displayPrice: string;
  /**
   * The amount as expo-iap's double (StoreKit's 1.99 arrives as 1.9899999999999998). Never shown;
   * arithmetic converts it once with value-objects-money-and-units' moneyFromStoreDouble.
   */
  // value-objects-allow float-money: expo-iap's own field (a double on both platforms), mirrored as is.
  readonly price: number | null;
  /** ISO 4217 code of the storefront's currency. */
  readonly currency: string;
};

/**
 * A transaction the platform has already verified on the device (StoreKit 2 checks the JWS; Play
 * Billing signs the purchase). Nothing here needs a server.
 */
export type StoreTransaction = {
  readonly productId: string;
  readonly transactionId: string;
  readonly state: 'purchased' | 'pending';
  /** iOS: refund or Family Sharing revocation evidence. Android never sets it (see the reference). */
  readonly revocationDateMs: number | null;
  /** Opaque: handed back to finish(). */
  readonly handle: unknown;
  /**
   * Android only: a purchase Play Billing still holds unacknowledged. It is never delivered to the
   * listener again and Google refunds it after 3 days (3 minutes for license testers), so the
   * re-check finishes it once Premium is on disk. iOS replays unfinished transactions instead.
   */
  readonly isUnfinished?: true;
};

/** Why a purchase did not complete, already mapped from the SDK's error code. */
export type PurchaseFailure = 'cancelled' | 'deferred' | 'already-owned' | 'unavailable' | 'failed';

export type PurchaseEvent =
  | { readonly type: 'transaction'; readonly transaction: StoreTransaction }
  | { readonly type: 'failure'; readonly failure: PurchaseFailure; readonly code: string };

/** A store call that failed: the SDK's error code ('unknown' without one), never shown to the user. */
export type StoreFailure = { readonly kind: 'store-error'; readonly code: string };

/** Every store call resolves with a value or a StoreFailure; none rejects. */
export type StoreResult<TValue> = Result<TValue, StoreFailure>;

/**
 * Adapters: expo-iap-purchase-adapter.ts (devices), fake-purchase.ts (tests). The composition root
 * wraps the device adapter in withConnectivity (connectivity-gated-purchase.ts).
 */
export type PurchasePort = {
  /** ok(false) when the store is not reachable (offline, billing unavailable). */
  readonly connect: () => Promise<StoreResult<boolean>>;
  /** ok(null) when the store returns no product (StoreKit answers [] instead of throwing). */
  readonly fetchProduct: (productId: string) => Promise<StoreResult<StoreProduct | null>>;
  /** Resolves once the sheet was requested; the outcome (or the failure) arrives through subscribe(). */
  readonly requestPurchase: (productId: string) => Promise<void>;
  readonly finish: (transaction: StoreTransaction) => Promise<StoreResult<void>>;
  /** iOS AppStore.sync(). An error is a failed sync: a cancelled account prompt, offline. */
  readonly restore: () => Promise<StoreResult<void>>;
  /** Every verified transaction, refunded ones included (iOS Transaction.all), for evidence. */
  readonly readTransactions: () => Promise<StoreResult<readonly StoreTransaction[]>>;
  readonly subscribe: (listener: (event: PurchaseEvent) => void) => () => void;
};
