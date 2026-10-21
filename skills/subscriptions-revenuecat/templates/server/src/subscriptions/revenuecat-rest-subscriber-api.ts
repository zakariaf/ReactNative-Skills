// server/src/subscriptions/revenuecat-rest-subscriber-api.ts: SubscriberApi over RevenueCat's REST API v1.
// GET https://api.revenuecat.com/v1/subscribers/{app_user_id} with the project's secret API key
// (a server secret; never in the app, never logged). The webhook and the sync endpoint both use it.
import type { RestSubscriber } from './entitlement-from-subscriber';
import type { SubscriberApi, SubscriberFetch } from './webhook-ports';

export type RestSubscriberApiOptions = {
  readonly secretApiKey: string;
  /** Injected so tests and other runtimes can pass their own; defaults to the global fetch. */
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
};

const DEFAULT_BASE_URL = 'https://api.revenuecat.com/v1';

function subscriberOf(json: unknown): RestSubscriber | null {
  if (typeof json !== 'object' || json === null) return null;
  const subscriber: unknown = Reflect.get(json, 'subscriber');
  return typeof subscriber === 'object' && subscriber !== null ? subscriber : null;
}

export function createRevenueCatSubscriberApi(options: RestSubscriberApiOptions): SubscriberApi {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  return {
    fetchSubscriber: async (appUserId): Promise<SubscriberFetch> => {
      try {
        const response = await fetchFn(`${baseUrl}/subscribers/${encodeURIComponent(appUserId)}`, {
          headers: { authorization: `Bearer ${options.secretApiKey}`, accept: 'application/json' },
        });
        if (response.status >= 500 || response.status === 429)
          return { ok: false, reason: 'unavailable' };
        if (!response.ok) return { ok: false, reason: 'rejected' };
        const subscriber = subscriberOf(await response.json());
        return subscriber === null ? { ok: false, reason: 'rejected' } : { ok: true, subscriber };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
  };
}
