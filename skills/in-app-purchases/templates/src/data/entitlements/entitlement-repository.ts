// src/data/entitlements/entitlement-repository.ts: the entitlements port: the one saved fact "Premium is owned".
import type { Result } from '@/core/result';

/**
 * The saved Premium entitlement. It turns off only with a dated revocation from the store (a refund
 * or a Family Sharing revocation), never by a reset ("Delete all my data" keeps the table).
 */
export type PremiumEntitlement = {
  readonly isOwned: boolean;
  /** When this device first saved the purchase; null while never owned. */
  readonly ownedSinceMs: number | null;
  /** The store's revocation date of the last revoke; null after a purchase. */
  readonly revokedAtMs: number | null;
};

/** No row yet: a fresh install, or a user who never bought. */
export const NOT_OWNED: PremiumEntitlement = {
  isOwned: false,
  ownedSinceMs: null,
  revokedAtMs: null,
};

/** Why an entitlement call failed in a way the app expects (error-handling-typed-results). */
export type EntitlementFailure =
  /** The entitlement failed its schema (an owned one without a date, a negative time): nothing was written. */
  | { readonly kind: 'entitlement-invalid' }
  | { readonly kind: 'storage-full' }
  | { readonly kind: 'storage-busy' }
  /** A damaged file, an I/O error or a bug: the raw error is already in the error log. */
  | { readonly kind: 'storage-unavailable'; readonly code: number | null };

/**
 * Synchronous: a save has committed when it returns ok. Never throws for a data reason.
 * Adapters: sqlite-entitlement-repository.ts (the app), fake-entitlement-repository.ts (tests).
 */
export type EntitlementRepository = {
  /** The saved entitlement; NOT_OWNED when there is no row (an unreadable row is logged). */
  readonly premium: () => Result<PremiumEntitlement, EntitlementFailure>;
  readonly savePremium: (entitlement: PremiumEntitlement) => Result<void, EntitlementFailure>;
};
