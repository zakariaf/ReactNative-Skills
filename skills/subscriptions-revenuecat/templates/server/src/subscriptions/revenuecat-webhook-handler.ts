// server/src/subscriptions/revenuecat-webhook-handler.ts: the RevenueCat webhook, server-agnostic.
// An HTTP adapter (a Cloud Functions onRequest, an Express or edge route) passes the Authorization
// header and the parsed JSON body and sends back { status, body }. Order: authenticate (constant
// time) -> parse -> claim the event id -> re-fetch every affected user's state -> write -> 200.
import { createHash, timingSafeEqual } from 'node:crypto';

import { entitlementFromSubscriber } from './entitlement-from-subscriber';
import { affectedUserIds, parseRevenueCatWebhook } from './revenuecat-event';

import type { RevenueCatEvent } from './revenuecat-event';
import type { WebhookDeps } from './webhook-ports';

export type WebhookRequest = {
  /** The request's Authorization header, or null when it has none. */
  readonly authorization: string | null;
  /** The parsed JSON body. */
  readonly body: unknown;
};

export type WebhookResponse = { readonly status: 200 | 400 | 401 | 500; readonly body: string };

const OK: WebhookResponse = { status: 200, body: 'ok' };

/** Hashing first gives both sides one length, so timingSafeEqual never throws or leaks the length. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function isAuthorized(received: string | null, expected: string): boolean {
  if (received === null || expected === '') return false;
  return timingSafeEqual(digest(received), digest(expected));
}

/** Re-fetches and writes each user; false when RevenueCat could not answer (nothing partial is kept). */
async function syncUsers(
  event: RevenueCatEvent,
  userIds: readonly string[],
  deps: WebhookDeps,
): Promise<boolean> {
  const fetched = await Promise.all(
    userIds.map(async (userId) => ({
      userId,
      result: await deps.subscribers.fetchSubscriber(userId),
    })),
  );
  if (fetched.some(({ result }) => !result.ok)) return false;
  const nowMs = deps.nowMs();
  await Promise.all(
    fetched.map(({ userId, result }) =>
      result.ok
        ? deps.entitlements.write(
            userId,
            entitlementFromSubscriber({
              subscriber: result.subscriber,
              entitlementId: deps.entitlementId,
              nowMs,
              sourceEventId: event.id,
            }),
          )
        : Promise.resolve(),
    ),
  );
  return true;
}

/**
 * Handles one delivery. 200 for processed, duplicate, test and anonymous-only events; 401 for a
 * wrong or missing Authorization header; 400 for a body that is no webhook; 500 when RevenueCat's
 * REST API failed, after releasing the claim, so RevenueCat retries (up to 5 times).
 */
export async function handleRevenueCatWebhook(
  request: WebhookRequest,
  deps: WebhookDeps,
): Promise<WebhookResponse> {
  if (!isAuthorized(request.authorization, deps.expectedAuthorization)) {
    deps.log({ outcome: 'unauthorized' });
    return { status: 401, body: 'unauthorized' };
  }
  const event = parseRevenueCatWebhook(request.body);
  if (event === null) {
    deps.log({ outcome: 'malformed' });
    return { status: 400, body: 'not a RevenueCat webhook' };
  }
  const entry = { eventId: event.id, eventType: event.type, environment: event.environment };
  if (event.type === 'TEST') {
    deps.log({ ...entry, outcome: 'test' });
    return OK;
  }
  const userIds = affectedUserIds(event);
  if (userIds.length === 0) {
    deps.log({ ...entry, outcome: 'anonymous-only' });
    return OK;
  }
  if ((await deps.ledger.claim(event.id)) === 'duplicate') {
    deps.log({ ...entry, outcome: 'duplicate' });
    return OK;
  }
  // A failed write counts like a failed fetch: release the claim so the retry runs again.
  const isSynced = await syncUsers(event, userIds, deps).catch(() => false);
  if (!isSynced) {
    await deps.ledger.release(event.id);
    deps.log({ ...entry, outcome: 'failed', users: userIds.length });
    return { status: 500, body: 'retry later' };
  }
  deps.log({ ...entry, outcome: 'written', users: userIds.length });
  return OK;
}
