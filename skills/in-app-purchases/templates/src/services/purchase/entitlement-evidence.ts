// src/services/purchase/entitlement-evidence.ts: what the store's transactions prove about Premium.
import type { StoreTransaction } from './purchase-port';

/** 'unknown' means "no evidence either way": the saved entitlement stays as it is. */
export type Evidence = 'owned' | 'revoked' | 'unknown';

/** A verified purchase of this product that was never refunded: the one "owned" test. */
export function isOwnedPurchase(tx: StoreTransaction, productId: string): boolean {
  return tx.productId === productId && tx.state === 'purchased' && tx.revocationDateMs === null;
}

/** Owned beats revoked (a newer purchase after a refund); absence is never evidence. */
export function entitlementEvidence(
  transactions: readonly StoreTransaction[],
  productId: string,
): Evidence {
  if (transactions.some((tx) => isOwnedPurchase(tx, productId))) return 'owned';
  const ofProduct = transactions.filter((tx) => tx.productId === productId);
  if (ofProduct.some((tx) => tx.revocationDateMs !== null)) return 'revoked';
  return 'unknown'; // a fresh purchase can be briefly missing from the list
}

/** The newest revocation date of this product (0 when there is none); a revoke is saved with it. */
export function latestRevocationMs(
  transactions: readonly StoreTransaction[],
  productId: string,
): number {
  return transactions
    .filter((tx) => tx.productId === productId)
    .reduce((latest, tx) => Math.max(latest, tx.revocationDateMs ?? 0), 0);
}
