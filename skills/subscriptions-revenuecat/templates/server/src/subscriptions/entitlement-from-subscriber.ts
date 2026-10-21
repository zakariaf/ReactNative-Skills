// server/src/subscriptions/entitlement-from-subscriber.ts: derives the entitlement record from RevenueCat's
// REST subscriber state (GET /v1/subscribers/{app_user_id}), never from a webhook body alone, so a
// replayed or out-of-order event cannot downgrade an active subscriber.
import type { EntitlementDoc, EntitlementStatus } from './entitlement-doc';

/** The fields of `subscriber.entitlements.<id>` this derivation reads (REST API v1). */
export type RestEntitlement = {
  readonly expires_date?: string | null;
  readonly grace_period_expires_date?: string | null;
  readonly product_identifier?: string;
};

/** The fields of `subscriber.subscriptions.<product id>` this derivation reads. */
export type RestSubscription = {
  readonly expires_date?: string | null;
  readonly billing_issues_detected_at?: string | null;
  readonly unsubscribe_detected_at?: string | null;
  readonly refunded_at?: string | null;
  readonly grace_period_expires_date?: string | null;
  readonly store?: string;
  readonly is_sandbox?: boolean;
};

export type RestSubscriber = {
  readonly entitlements?: Readonly<Record<string, RestEntitlement>>;
  readonly subscriptions?: Readonly<Record<string, RestSubscription>>;
};

export type DeriveInput = {
  readonly subscriber: RestSubscriber;
  readonly entitlementId: string;
  readonly nowMs: number;
  readonly sourceEventId: string;
};

function msOf(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

type Facts = {
  readonly expiresAtMs: number | null;
  readonly graceUntilMs: number | null;
  readonly isRefunded: boolean;
  readonly hasBillingIssue: boolean;
  readonly isUnsubscribed: boolean;
};

function factsOf(entitlement: RestEntitlement, subscription: RestSubscription | undefined): Facts {
  const grace = entitlement.grace_period_expires_date ?? subscription?.grace_period_expires_date;
  return {
    expiresAtMs: msOf(entitlement.expires_date),
    graceUntilMs: msOf(grace),
    isRefunded: msOf(subscription?.refunded_at) !== null,
    hasBillingIssue: msOf(subscription?.billing_issues_detected_at) !== null,
    isUnsubscribed: msOf(subscription?.unsubscribe_detected_at) !== null,
  };
}

function statusOf(facts: Facts, nowMs: number): EntitlementStatus {
  if (facts.isRefunded) return 'refunded';
  const isInGrace = facts.graceUntilMs !== null && facts.graceUntilMs > nowMs;
  if (facts.hasBillingIssue && isInGrace) return 'grace';
  const isLive = facts.expiresAtMs === null || facts.expiresAtMs > nowMs;
  if (!isLive) return facts.hasBillingIssue ? 'billing-retry' : 'expired';
  return facts.isUnsubscribed ? 'cancelled-active' : 'active';
}

function subscriptionOf(
  subscriber: RestSubscriber,
  productId: string | null,
): RestSubscription | undefined {
  return productId === null ? undefined : subscriber.subscriptions?.[productId];
}

/** The record to write for one user; status 'none' when the entitlement was never granted. */
export function entitlementFromSubscriber(input: DeriveInput): EntitlementDoc {
  const entitlement = input.subscriber.entitlements?.[input.entitlementId];
  const productId = entitlement?.product_identifier ?? null;
  const subscription = subscriptionOf(input.subscriber, productId);
  const base = {
    entitlementId: input.entitlementId,
    productId,
    store: subscription?.store ?? null,
    isSandbox: subscription?.is_sandbox === true,
    updatedAtMs: input.nowMs,
    sourceEventId: input.sourceEventId,
  };
  if (entitlement === undefined)
    return { ...base, status: 'none', expiresAtMs: null, graceUntilMs: null };
  const facts = factsOf(entitlement, subscription);
  return {
    ...base,
    status: statusOf(facts, input.nowMs),
    expiresAtMs: facts.expiresAtMs,
    graceUntilMs: facts.graceUntilMs,
  };
}
