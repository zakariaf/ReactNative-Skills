// src/services/subscription/subscription-port.ts: the app's one seam to the subscription SDK.
// Only revenuecat-subscription-adapter.ts implements it with react-native-purchases; tests and the
// dev build use fake-subscription.ts. Every call resolves to a Result; none rejects.
import type { Result } from '@/core/result';

/** Why a subscription call did not succeed: the paywall maps each kind to one state. */
export type SubscriptionFailureKind =
  | 'store-unavailable'
  | 'cancelled'
  | 'pending'
  | 'network'
  | 'not-allowed'
  | 'already-owned'
  | 'not-configured'
  | 'unknown';

/** `code` is the SDK's own error code, kept for the error log; never shown to the user. */
export type SubscriptionFailure = {
  readonly kind: SubscriptionFailureKind;
  readonly code: string;
};

export type SubscriptionResult<TValue> = Result<TValue, SubscriptionFailure>;

export type SubscriptionPeriod = 'monthly' | 'annual' | 'other';

/** One package of the current offering, with the store's own price strings. */
export type SubscriptionPackage = {
  readonly packageId: string;
  readonly productId: string;
  readonly period: SubscriptionPeriod;
  /** The store's localized price string, shown unchanged. */
  readonly priceText: string;
  /** The SDK's per-month price string for longer periods, or null; never computed in the app. */
  readonly pricePerMonthText: string | null;
};

export type SubscriptionOffer = {
  readonly offeringId: string;
  readonly packages: readonly SubscriptionPackage[];
};

/**
 * What the device's SDK believes about the entitlement. It drives the UI only (a badge, the
 * paywall's "already Premium" state, a hint to ask the server to sync); server decisions read the
 * entitlement document the webhook writes.
 */
export type ClientEntitlement = {
  readonly isActive: boolean;
  readonly productId: string | null;
  readonly expiresAtMs: number | null;
  readonly willRenew: boolean;
  readonly hasBillingIssue: boolean;
};

export type SubscriptionPort = {
  /** Configures the SDK once, with the backend user id (never an anonymous SDK id). */
  readonly configure: (appUserId: string) => SubscriptionResult<void>;
  /** Switches the SDK to another backend user id after sign-in or an account change. */
  readonly logIn: (appUserId: string) => Promise<SubscriptionResult<ClientEntitlement>>;
  /** Forgets the signed-out user on this device. */
  readonly logOut: () => Promise<SubscriptionResult<void>>;
  /** The current offering; ok(null) when the store returned no packages. */
  readonly getOffer: () => Promise<SubscriptionResult<SubscriptionOffer | null>>;
  readonly purchase: (packageId: string) => Promise<SubscriptionResult<ClientEntitlement>>;
  readonly restore: () => Promise<SubscriptionResult<ClientEntitlement>>;
  readonly getEntitlement: () => Promise<SubscriptionResult<ClientEntitlement>>;
  /** Calls `listener` whenever the SDK's customer info changes; returns the unsubscribe. */
  readonly onEntitlementChange: (listener: (entitlement: ClientEntitlement) => void) => () => void;
  /** The store's manage-subscription page for the current user, or ok(null). */
  readonly managementUrl: () => Promise<SubscriptionResult<string | null>>;
};

export const NO_ENTITLEMENT: ClientEntitlement = {
  isActive: false,
  productId: null,
  expiresAtMs: null,
  willRenew: false,
  hasBillingIssue: false,
};
