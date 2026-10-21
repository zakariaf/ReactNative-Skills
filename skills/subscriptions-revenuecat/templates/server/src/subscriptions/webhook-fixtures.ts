// server/src/subscriptions/webhook-fixtures.ts: webhook bodies and REST snapshots for the handler's tests.
// Shapes follow RevenueCat's documented payloads (api_version 1.0); replace them with recorded
// sandbox payloads once the app has some (secrets and receipts removed).
import type { RestSubscriber } from './entitlement-from-subscriber';

export const DAY_MS = 86_400_000;
export const NOW_MS = Date.parse('2026-10-01T12:00:00Z');
export const MONTHLY = 'com.example.tasks.premium.monthly';
export const ANNUAL = 'com.example.tasks.premium.annual';

const iso = (ms: number): string => new Date(ms).toISOString();

export type EventFields = {
  readonly id: string;
  /** The event's `type` (INITIAL_PURCHASE, RENEWAL, ...). */
  readonly eventType: string;
  readonly app_user_id?: string;
  readonly transferred_from?: readonly string[];
  readonly transferred_to?: readonly string[];
  readonly cancel_reason?: string;
};

export function webhookBody(fields: EventFields): unknown {
  const { eventType, ...rest } = fields;
  return {
    api_version: '1.0',
    event: {
      environment: 'SANDBOX',
      event_timestamp_ms: NOW_MS,
      entitlement_ids: ['premium'],
      product_id: MONTHLY,
      type: eventType,
      ...rest,
    },
  };
}

export type SnapshotFields = {
  readonly productId?: string;
  readonly expiresInMs: number;
  readonly graceInMs?: number;
  readonly billingIssue?: boolean;
  readonly unsubscribed?: boolean;
  readonly refunded?: boolean;
};

/** RevenueCat's REST state for a subscriber of the `premium` entitlement, relative to NOW_MS. */
export function premiumSnapshot(fields: SnapshotFields): RestSubscriber {
  const productId = fields.productId ?? MONTHLY;
  const expires = iso(NOW_MS + fields.expiresInMs);
  const grace = fields.graceInMs === undefined ? null : iso(NOW_MS + fields.graceInMs);
  const mark = (isSet: boolean | undefined): string | null =>
    isSet === true ? iso(NOW_MS - DAY_MS) : null;
  return {
    entitlements: {
      premium: {
        expires_date: expires,
        grace_period_expires_date: grace,
        product_identifier: productId,
      },
    },
    subscriptions: {
      [productId]: {
        expires_date: expires,
        grace_period_expires_date: grace,
        billing_issues_detected_at: mark(fields.billingIssue),
        unsubscribe_detected_at: mark(fields.unsubscribed),
        refunded_at: mark(fields.refunded),
        store: 'app_store',
        is_sandbox: true,
      },
    },
  };
}

export const NEVER_SUBSCRIBED: RestSubscriber = { entitlements: {}, subscriptions: {} };
