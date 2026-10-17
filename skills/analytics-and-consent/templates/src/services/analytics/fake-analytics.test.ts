// src/services/analytics/fake-analytics.test.ts
import {
  createFakeAnalytics,
  createFakeAnalyticsSdk,
  createMemoryAnalyticsConsentStore,
} from './fake-analytics';

describe('createFakeAnalytics', () => {
  it('records events and follows the consent calls', async () => {
    const analytics = createFakeAnalytics();
    analytics.track({ name: 'paywall_viewed', props: { source: 'settings' } });
    analytics.setConsent('granted');
    expect(analytics.consent()).toBe('granted');
    await analytics.flush();
    await analytics.forget();
    expect(analytics.consent()).toBe('unknown');
    expect(analytics.events()).toStrictEqual([
      { name: 'paywall_viewed', props: { source: 'settings' } },
    ]);
  });
});

describe('createFakeAnalyticsSdk', () => {
  it('logs every call and fails on request', async () => {
    const sdk = createFakeAnalyticsSdk();
    await sdk.optIn();
    sdk.capture('screen_view', { screen: 'index' });
    await sdk.flush();
    sdk.reset();
    await sdk.optOut();
    expect(sdk.calls()).toStrictEqual(['optIn', 'capture screen_view', 'flush', 'reset', 'optOut']);
    expect(sdk.captured()).toStrictEqual([{ name: 'screen_view', props: { screen: 'index' } }]);
    expect(() => {
      createFakeAnalyticsSdk('reset').reset();
    }).toThrow('reset failed');
  });
});

describe('createMemoryAnalyticsConsentStore', () => {
  it('keeps, replaces and clears the record text', () => {
    const store = createMemoryAnalyticsConsentStore('a');
    expect(store.read()).toStrictEqual({ ok: true, value: 'a' });
    store.write('b');
    expect(store.saved()).toBe('b');
    store.clear();
    expect(store.read()).toStrictEqual({ ok: true, value: null });
  });
});
