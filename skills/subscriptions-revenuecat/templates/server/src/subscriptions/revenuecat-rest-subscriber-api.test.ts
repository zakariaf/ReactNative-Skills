// server/src/subscriptions/revenuecat-rest-subscriber-api.test.ts
import { createRevenueCatSubscriberApi } from './revenuecat-rest-subscriber-api';

function fetchAnswering(
  status: number,
  json: unknown,
): { readonly fetchFn: typeof fetch; readonly calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return Promise.resolve(new Response(JSON.stringify(json), { status }));
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('createRevenueCatSubscriberApi', () => {
  it('reads the subscriber with the secret key as a Bearer token', async () => {
    const body = { subscriber: { entitlements: { premium: { product_identifier: 'monthly' } } } };
    const { fetchFn, calls } = fetchAnswering(200, body);
    const api = createRevenueCatSubscriberApi({
      secretApiKey: 'sk_test',
      fetchFn,
      baseUrl: 'rest-base',
    });
    // Response.json() builds its objects in another realm, so read a field instead of deep equality.
    const result = await api.fetchSubscriber('user/1');
    expect(result.ok ? result.subscriber.entitlements?.['premium']?.product_identifier : null).toBe(
      'monthly',
    );
    expect(calls[0]?.[0]).toBe('rest-base/subscribers/user%2F1');
    expect(calls[0]?.[1]?.headers).toStrictEqual({
      authorization: 'Bearer sk_test',
      accept: 'application/json',
    });
  });

  it.each([
    [500, 'unavailable'],
    [429, 'unavailable'],
    [401, 'rejected'],
  ])('answers %i as %s', async (status, reason) => {
    const { fetchFn } = fetchAnswering(status, {});
    await expect(
      createRevenueCatSubscriberApi({ secretApiKey: 'sk_test', fetchFn }).fetchSubscriber('u'),
    ).resolves.toStrictEqual({ ok: false, reason });
  });

  it('answers a network failure as unavailable, never a rejection', async () => {
    const fetchFn = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    await expect(
      createRevenueCatSubscriberApi({ secretApiKey: 'sk_test', fetchFn }).fetchSubscriber('u'),
    ).resolves.toStrictEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});
