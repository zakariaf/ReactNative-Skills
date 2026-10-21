// server/src/subscriptions/revenuecat-webhook-handler.test.ts
import { resolvePlan } from './entitlement-doc';
import { createFakeWebhookWorld, TEST_AUTHORIZATION } from './fake-webhook-deps';
import { handleRevenueCatWebhook } from './revenuecat-webhook-handler';
import {
  ANNUAL,
  DAY_MS,
  NEVER_SUBSCRIBED,
  NOW_MS,
  premiumSnapshot,
  webhookBody,
} from './webhook-fixtures';

import type { EntitlementStatus, Plan } from './entitlement-doc';
import type { FakeWebhookWorld } from './fake-webhook-deps';
import type { EventFields, SnapshotFields } from './webhook-fixtures';

function deliver(
  world: FakeWebhookWorld,
  fields: EventFields,
  authorization: string | null = TEST_AUTHORIZATION,
) {
  return handleRevenueCatWebhook({ authorization, body: webhookBody(fields) }, world.deps);
}

type Scenario = {
  readonly name: string;
  readonly event: EventFields;
  readonly snapshot: SnapshotFields | null;
  readonly plan: Plan;
  readonly status: EntitlementStatus;
};

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'initial purchase',
    event: { id: 'e1', eventType: 'INITIAL_PURCHASE' },
    snapshot: { expiresInMs: 30 * DAY_MS },
    plan: 'premium',
    status: 'active',
  },
  {
    name: 'renewal',
    event: { id: 'e2', eventType: 'RENEWAL' },
    snapshot: { expiresInMs: 30 * DAY_MS },
    plan: 'premium',
    status: 'active',
  },
  {
    name: 'cancellation while still paid',
    event: { id: 'e3', eventType: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' },
    snapshot: { expiresInMs: 5 * DAY_MS, unsubscribed: true },
    plan: 'premium',
    status: 'cancelled-active',
  },
  {
    name: 'uncancellation',
    event: { id: 'e4', eventType: 'UNCANCELLATION' },
    snapshot: { expiresInMs: 5 * DAY_MS },
    plan: 'premium',
    status: 'active',
  },
  {
    name: 'refund',
    event: { id: 'e5', eventType: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' },
    snapshot: { expiresInMs: 5 * DAY_MS, refunded: true },
    plan: 'free',
    status: 'refunded',
  },
  {
    name: 'billing issue inside the grace period',
    event: { id: 'e6', eventType: 'BILLING_ISSUE' },
    snapshot: { expiresInMs: -DAY_MS, billingIssue: true, graceInMs: 6 * DAY_MS },
    plan: 'premium',
    status: 'grace',
  },
  {
    name: 'billing retry without grace',
    event: { id: 'e7', eventType: 'BILLING_ISSUE' },
    snapshot: { expiresInMs: -DAY_MS, billingIssue: true },
    plan: 'free',
    status: 'billing-retry',
  },
  {
    name: 'expiration',
    event: { id: 'e8', eventType: 'EXPIRATION' },
    snapshot: { expiresInMs: -DAY_MS },
    plan: 'free',
    status: 'expired',
  },
  {
    name: 'product change to annual',
    event: { id: 'e9', eventType: 'PRODUCT_CHANGE' },
    snapshot: { productId: ANNUAL, expiresInMs: 365 * DAY_MS },
    plan: 'premium',
    status: 'active',
  },
  {
    name: 'a user who never subscribed',
    event: { id: 'e10', eventType: 'EXPIRATION' },
    snapshot: null,
    plan: 'free',
    status: 'none',
  },
];

describe('handleRevenueCatWebhook', () => {
  it.each(SCENARIOS)(
    'writes the re-fetched state for $name',
    async ({ event, snapshot, plan, status }) => {
      const world = createFakeWebhookWorld(NOW_MS);
      world.snapshots.set(
        'user-1',
        snapshot === null ? NEVER_SUBSCRIBED : premiumSnapshot(snapshot),
      );
      const response = await deliver(world, { app_user_id: 'user-1', ...event });
      expect(response).toStrictEqual({ status: 200, body: 'ok' });
      const doc = world.written.get('user-1');
      expect(doc?.status).toBe(status);
      expect(doc?.sourceEventId).toBe(event.id);
      expect(resolvePlan(doc, NOW_MS)).toBe(plan);
    },
  );

  it('rejects a missing or wrong Authorization header with 401 and writes nothing', async () => {
    const world = createFakeWebhookWorld(NOW_MS);
    world.snapshots.set('user-1', premiumSnapshot({ expiresInMs: DAY_MS }));
    const event = { id: 'e1', eventType: 'INITIAL_PURCHASE', app_user_id: 'user-1' };
    const statuses = await Promise.all(
      [null, 'Bearer wrong', ''].map(
        async (header) => (await deliver(world, event, header)).status,
      ),
    );
    expect(statuses).toStrictEqual([401, 401, 401]);
    expect(world.written.size).toBe(0);
    expect(world.claimed.size).toBe(0);
  });

  it('processes a retried delivery of the same event id once', async () => {
    const world = createFakeWebhookWorld(NOW_MS);
    world.snapshots.set('user-1', premiumSnapshot({ expiresInMs: DAY_MS }));
    const event = { id: 'e1', eventType: 'RENEWAL', app_user_id: 'user-1' };
    await deliver(world, event);
    world.written.clear();
    await expect(deliver(world, event)).resolves.toStrictEqual({ status: 200, body: 'ok' });
    expect(world.written.size).toBe(0);
    expect(world.logs.at(-1)?.outcome).toBe('duplicate');
  });

  it('keeps an active subscriber when an old expiration arrives after a renewal', async () => {
    const world = createFakeWebhookWorld(NOW_MS);
    world.snapshots.set('user-1', premiumSnapshot({ expiresInMs: 30 * DAY_MS }));
    await deliver(world, { id: 'renewal', eventType: 'RENEWAL', app_user_id: 'user-1' });
    await deliver(world, { id: 'late-expiration', eventType: 'EXPIRATION', app_user_id: 'user-1' });
    expect(resolvePlan(world.written.get('user-1'), NOW_MS)).toBe('premium');
  });

  it('updates both users of a transfer', async () => {
    const world = createFakeWebhookWorld(NOW_MS);
    world.snapshots.set('old-user', NEVER_SUBSCRIBED);
    world.snapshots.set('new-user', premiumSnapshot({ expiresInMs: 30 * DAY_MS }));
    await deliver(world, {
      id: 't1',
      eventType: 'TRANSFER',
      transferred_from: ['old-user'],
      transferred_to: ['new-user'],
    });
    expect(resolvePlan(world.written.get('old-user'), NOW_MS)).toBe('free');
    expect(resolvePlan(world.written.get('new-user'), NOW_MS)).toBe('premium');
  });

  it('answers 500 and releases the claim when RevenueCat cannot answer, so the retry runs', async () => {
    const world = createFakeWebhookWorld(NOW_MS);
    const event = { id: 'e1', eventType: 'RENEWAL', app_user_id: 'user-1' };
    const first = await deliver(world, event);
    expect(first.status).toBe(500);
    expect(world.claimed.has('e1')).toBe(false);
    world.snapshots.set('user-1', premiumSnapshot({ expiresInMs: DAY_MS }));
    await deliver(world, event);
    expect(world.written.get('user-1')?.status).toBe('active');
  });

  it('logs and ignores TEST events and anonymous SDK ids', async () => {
    const world = createFakeWebhookWorld(NOW_MS);
    await deliver(world, { id: 'x1', eventType: 'TEST', app_user_id: 'user-1' });
    await deliver(world, {
      id: 'x2',
      eventType: 'INITIAL_PURCHASE',
      app_user_id: '$RCAnonymousID:abc',
    });
    expect(world.written.size).toBe(0);
    expect(world.logs.map((entry) => entry.outcome)).toStrictEqual(['test', 'anonymous-only']);
  });

  it('answers 400 for a body that is no webhook', async () => {
    const world = createFakeWebhookWorld(NOW_MS);
    const response = await handleRevenueCatWebhook(
      { authorization: TEST_AUTHORIZATION, body: { hello: 'world' } },
      world.deps,
    );
    expect(response.status).toBe(400);
  });
});
