// server/src/subscriptions/fake-webhook-deps.ts: in-memory WebhookDeps for the handler's tests.
// The ledger behaves like a create-if-absent document; the subscriber API answers from a table
// of REST snapshots (the state RevenueCat holds now, whatever event arrives).
import type { EntitlementDoc } from './entitlement-doc';
import type { RestSubscriber } from './entitlement-from-subscriber';
import type {
  EventLedger,
  SubscriberApi,
  SubscriberFetch,
  WebhookDeps,
  WebhookLogEntry,
} from './webhook-ports';

export const TEST_AUTHORIZATION = 'Bearer test-webhook-value';

export type FakeWebhookWorld = {
  readonly deps: WebhookDeps;
  readonly claimed: Set<string>;
  readonly written: Map<string, EntitlementDoc>;
  readonly logs: WebhookLogEntry[];
  /** The REST state per user; a user missing here answers 'unavailable'. */
  readonly snapshots: Map<string, RestSubscriber>;
  readonly setNowMs: (nowMs: number) => void;
};

/** A create-if-absent ledger over a Set, like a Firestore `create` or an INSERT that fails on conflict. */
function memoryLedger(claimed: Set<string>): EventLedger {
  return {
    claim: (eventId) => {
      if (claimed.has(eventId)) return Promise.resolve('duplicate');
      claimed.add(eventId);
      return Promise.resolve('claimed');
    },
    release: (eventId) => {
      claimed.delete(eventId);
      return Promise.resolve();
    },
  };
}

function snapshotApi(snapshots: ReadonlyMap<string, RestSubscriber>): SubscriberApi {
  return {
    fetchSubscriber: (userId): Promise<SubscriberFetch> => {
      const subscriber = snapshots.get(userId);
      return Promise.resolve(
        subscriber === undefined ? { ok: false, reason: 'unavailable' } : { ok: true, subscriber },
      );
    },
  };
}

export function createFakeWebhookWorld(startMs: number): FakeWebhookWorld {
  const claimed = new Set<string>();
  const written = new Map<string, EntitlementDoc>();
  const logs: WebhookLogEntry[] = [];
  const snapshots = new Map<string, RestSubscriber>();
  let nowMs = startMs;
  const deps: WebhookDeps = {
    expectedAuthorization: TEST_AUTHORIZATION,
    entitlementId: 'premium',
    ledger: memoryLedger(claimed),
    subscribers: snapshotApi(snapshots),
    entitlements: {
      write: (userId, doc) => {
        written.set(userId, doc);
        return Promise.resolve();
      },
    },
    nowMs: () => nowMs,
    log: (entry) => {
      logs.push(entry);
    },
  };
  const setNowMs = (next: number): void => {
    nowMs = next;
  };
  return { deps, claimed, written, logs, snapshots, setNowMs };
}
