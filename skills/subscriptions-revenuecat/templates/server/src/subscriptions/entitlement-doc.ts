// server/src/subscriptions/entitlement-doc.ts: the server's entitlement record and the one plan decision.
// Only the webhook handler and the sync endpoint write the record (from RevenueCat's REST state);
// every quota and premium-only endpoint reads it through resolvePlan. A client's own belief
// (customer info, a flag in the request) never decides a plan.

export type EntitlementStatus =
  'active' | 'cancelled-active' | 'grace' | 'billing-retry' | 'expired' | 'refunded' | 'none';

export type EntitlementDoc = {
  readonly entitlementId: string;
  readonly status: EntitlementStatus;
  readonly productId: string | null;
  readonly store: string | null;
  readonly isSandbox: boolean;
  /** Null only for a non-expiring purchase (status active). */
  readonly expiresAtMs: number | null;
  /** End of the store's billing grace period, while a billing issue is open. */
  readonly graceUntilMs: number | null;
  readonly updatedAtMs: number;
  /** The webhook event id, or `sync:<ms>` for a sync call: which delivery wrote this state. */
  readonly sourceEventId: string;
};

export type Plan = 'free' | 'premium';

const STATUSES: ReadonlySet<string> = new Set([
  'active',
  'cancelled-active',
  'grace',
  'billing-retry',
  'expired',
  'refunded',
  'none',
]);

const isTimeOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

/** True only for a well-formed record; anything else resolves to free. */
export function isEntitlementDoc(value: unknown): value is EntitlementDoc {
  if (typeof value !== 'object' || value === null) return false;
  const status: unknown = Reflect.get(value, 'status');
  return (
    typeof status === 'string' &&
    STATUSES.has(status) &&
    isTimeOrNull(Reflect.get(value, 'expiresAtMs')) &&
    isTimeOrNull(Reflect.get(value, 'graceUntilMs'))
  );
}

/**
 * The plan at `nowMs` (server time only). Premium while active or cancelled-but-not-expired, and
 * during a grace period; free for billing retry without grace, expiry, refund, no record or a
 * malformed one. Time is re-checked here, so a missing expiration event never keeps Premium.
 */
export function resolvePlan(doc: unknown, nowMs: number): Plan {
  if (!isEntitlementDoc(doc)) return 'free';
  if (doc.status === 'grace')
    return doc.graceUntilMs !== null && doc.graceUntilMs > nowMs ? 'premium' : 'free';
  if (doc.status !== 'active' && doc.status !== 'cancelled-active') return 'free';
  return doc.expiresAtMs === null || doc.expiresAtMs > nowMs ? 'premium' : 'free';
}
