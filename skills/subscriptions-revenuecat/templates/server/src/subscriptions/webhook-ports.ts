// server/src/subscriptions/webhook-ports.ts: what the webhook handler needs from the server, as ports.
// Adapters: a database ledger and entitlement writer (Firestore, Postgres, ...), the RevenueCat
// REST client (revenuecat-rest-subscriber-api.ts); fakes: fake-webhook-deps.ts.
import type { EntitlementDoc } from './entitlement-doc';
import type { RestSubscriber } from './entitlement-from-subscriber';

/**
 * Processed webhook events, keyed by RevenueCat's event id. `claim` is create-if-absent and
 * atomic (a Firestore `create`, an INSERT that fails on conflict): 'duplicate' when the id exists.
 */
export type EventLedger = {
  readonly claim: (eventId: string) => Promise<'claimed' | 'duplicate'>;
  /** Removes a claim whose processing failed, so RevenueCat's retry is processed again. */
  readonly release: (eventId: string) => Promise<void>;
};

export type SubscriberFetch =
  | { readonly ok: true; readonly subscriber: RestSubscriber }
  | { readonly ok: false; readonly reason: 'unavailable' | 'rejected' };

export type SubscriberApi = {
  /** GET /v1/subscribers/{appUserId} with the REST secret key. */
  readonly fetchSubscriber: (appUserId: string) => Promise<SubscriberFetch>;
};

export type EntitlementWriter = {
  readonly write: (userId: string, doc: EntitlementDoc) => Promise<void>;
};

/** Structured, receipt-free log lines; user ids are hashed by the adapter that prints them. */
export type WebhookLogEntry = {
  readonly outcome:
    'unauthorized' | 'malformed' | 'test' | 'duplicate' | 'anonymous-only' | 'written' | 'failed';
  readonly eventId?: string;
  readonly eventType?: string;
  readonly environment?: string | null;
  readonly users?: number;
};

export type WebhookDeps = {
  /** The exact Authorization header value set in the RevenueCat dashboard (a server secret). */
  readonly expectedAuthorization: string;
  readonly entitlementId: string;
  readonly ledger: EventLedger;
  readonly subscribers: SubscriberApi;
  readonly entitlements: EntitlementWriter;
  readonly nowMs: () => number;
  readonly log: (entry: WebhookLogEntry) => void;
};
