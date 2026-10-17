// src/services/analytics/create-analytics.test.ts
// The consent gate: opt-in before any SDK exists, "no" stops and forgets, off builds never create the
// SDK, the catalog is enforced at run time, and nothing ever throws.
import { encodeConsentRecord } from './analytics-consent';
import { createAnalytics, MAX_PENDING_EVENTS } from './create-analytics';
import { createFakeAnalyticsSdk, createMemoryAnalyticsConsentStore } from './fake-analytics';

import type { AnalyticsEvent } from './analytics-events';
import type { AnalyticsSdk } from './analytics-port';
import type { CreateAnalyticsOptions } from './create-analytics';
import type { AnalyticsMode } from '@/config/analytics-config';
import type { TrackingStatus } from '@/services/consent/consent-port';

const CREATED: AnalyticsEvent = {
  name: 'task_created',
  props: { list_kind: 'inbox', has_due_date: true, has_reminder: false },
};

type Setup = {
  readonly mode?: AnalyticsMode;
  readonly saved?: string | null;
  readonly sdk?: AnalyticsSdk;
  readonly tracking?: TrackingStatus;
  readonly consentVersion?: number;
};

function setup({
  mode = 'live',
  saved = null,
  sdk = createFakeAnalyticsSdk(),
  tracking,
  consentVersion,
}: Setup = {}) {
  const store = createMemoryAnalyticsConsentStore(saved);
  const createSdk = jest.fn<AnalyticsSdk, Parameters<CreateAnalyticsOptions['createSdk']>>(
    () => sdk,
  );
  const onError = jest.fn<undefined, [unknown]>();
  const clearSdkStorage = jest.fn<undefined, []>();
  const requestTracking = jest.fn(() => Promise.resolve(tracking ?? 'unavailable'));
  const analytics = createAnalytics({
    mode,
    store,
    createSdk,
    nowMs: () => 1_700_000_000_000,
    onError,
    clearSdkStorage,
    ...(tracking === undefined ? {} : { tracking: { requestTracking } }),
    ...(consentVersion === undefined ? {} : { consentVersion }),
  });
  return { analytics, store, createSdk, onError, requestTracking, clearSdkStorage };
}

const granted = encodeConsentRecord({ choice: 'granted', version: 1, decidedAtMs: 1 });

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('createAnalytics consent', () => {
  it('creates no SDK and sends nothing before the user answered', async () => {
    const { analytics, createSdk } = setup();
    analytics.track(CREATED);
    await settle();
    expect(analytics.consent()).toBe('unknown');
    expect(createSdk).not.toHaveBeenCalled();
  });

  it('creates the SDK once after a yes, opts it in, then sends checked events', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics, createSdk, store } = setup({ sdk });
    analytics.setConsent('granted');
    analytics.track(CREATED);
    analytics.track(CREATED);
    await settle();
    expect(createSdk).toHaveBeenCalledTimes(1);
    expect(createSdk).toHaveBeenCalledWith({ isTrackingAllowed: false });
    expect(sdk.calls()).toStrictEqual(['optIn', 'capture task_created', 'capture task_created']);
    expect(JSON.parse(store.saved() ?? '{}')).toStrictEqual({
      choice: 'granted',
      version: 1,
      decidedAtMs: 1_700_000_000_000,
    });
  });

  it('reads a saved yes on a later launch', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics } = setup({ saved: granted, sdk });
    analytics.track(CREATED);
    await settle();
    expect(sdk.captured()).toStrictEqual([{ name: 'task_created', props: CREATED.props }]);
  });

  it('treats an answer to an older question as no answer', async () => {
    const old = encodeConsentRecord({ choice: 'granted', version: 0, decidedAtMs: 1 });
    const { analytics, createSdk } = setup({ saved: old });
    analytics.track(CREATED);
    await settle();
    expect(analytics.consent()).toBe('unknown');
    expect(createSdk).not.toHaveBeenCalled();
  });

  it('resets the identity and then opts out on a no, and sends nothing after it', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics } = setup({ saved: granted, sdk });
    analytics.track(CREATED);
    await settle();
    analytics.setConsent('denied');
    analytics.track(CREATED);
    await settle();
    expect(sdk.calls()).toStrictEqual(['optIn', 'capture task_created', 'reset', 'optOut']);
  });

  it('opts the same SDK in again after a later yes', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics, createSdk } = setup({ saved: granted, sdk });
    analytics.track(CREATED);
    await settle();
    analytics.setConsent('denied');
    analytics.setConsent('granted');
    await settle();
    expect(createSdk).toHaveBeenCalledTimes(1);
    expect(sdk.calls().slice(-3)).toStrictEqual(['reset', 'optOut', 'optIn']);
  });

  it('forgets: clears the saved answer and stops the SDK', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics, store } = setup({ saved: granted, sdk });
    analytics.track(CREATED);
    await settle();
    await analytics.forget();
    expect(store.saved()).toBeNull();
    expect(analytics.consent()).toBe('unknown');
    expect(sdk.calls().slice(-2)).toStrictEqual(['reset', 'optOut']);
  });
});

describe('createAnalytics stored SDK state', () => {
  it('clears the stored SDK state on a no after the question changed, without creating the SDK', async () => {
    const { analytics, createSdk, clearSdkStorage } = setup({ saved: granted, consentVersion: 2 });
    expect(analytics.consent()).toBe('unknown');
    analytics.setConsent('denied');
    await settle();
    expect(clearSdkStorage).toHaveBeenCalledTimes(1);
    expect(createSdk).not.toHaveBeenCalled();
  });

  it('clears the stored SDK state on forget() in a session where analytics never started', async () => {
    const { analytics, createSdk, clearSdkStorage } = setup();
    await analytics.forget();
    expect(clearSdkStorage).toHaveBeenCalledTimes(1);
    expect(createSdk).not.toHaveBeenCalled();
  });

  it('resets a running SDK instead of clearing its storage behind its back', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics, clearSdkStorage } = setup({ saved: granted, sdk });
    analytics.track(CREATED);
    await settle();
    analytics.setConsent('denied');
    await settle();
    expect(clearSdkStorage).not.toHaveBeenCalled();
    expect(sdk.calls().slice(-2)).toStrictEqual(['reset', 'optOut']);
  });

  it('records a failing storage clear instead of throwing', async () => {
    const { analytics, clearSdkStorage, onError } = setup();
    clearSdkStorage.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    await expect(analytics.forget()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('createAnalytics modes and tracking', () => {
  it('creates no SDK in an off build, even after a yes', async () => {
    const { analytics, createSdk } = setup({ mode: 'off' });
    analytics.setConsent('granted');
    analytics.track(CREATED);
    await analytics.flush();
    await settle();
    expect(createSdk).not.toHaveBeenCalled();
  });

  it('asks nothing of Apple in the default profile', async () => {
    const { analytics, createSdk } = setup({ saved: granted });
    analytics.track(CREATED);
    await settle();
    expect(createSdk).toHaveBeenCalledWith({ isTrackingAllowed: false });
  });

  it('tells the adapter about tracking only after an authorized ATT answer', async () => {
    const allowed = setup({ saved: granted, tracking: 'authorized' });
    allowed.analytics.track(CREATED);
    await settle();
    expect(allowed.createSdk).toHaveBeenCalledWith({ isTrackingAllowed: true });

    const declined = setup({ saved: granted, tracking: 'denied' });
    declined.analytics.track(CREATED);
    await settle();
    expect(declined.createSdk).toHaveBeenCalledWith({ isTrackingAllowed: false });
    expect(declined.requestTracking).toHaveBeenCalledTimes(1);
  });

  it('flushes only a running, allowed SDK', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics } = setup({ saved: granted, sdk });
    await analytics.flush();
    analytics.track(CREATED);
    await settle();
    await analytics.flush();
    expect(sdk.calls()).toStrictEqual(['optIn', 'capture task_created', 'flush']);
  });
});

describe('createAnalytics safety', () => {
  it('drops events outside the catalog and records why', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics, onError } = setup({ saved: granted, sdk });
    const forged = { name: 'task_created', props: { list_kind: 'Groceries for Sam' } } as never;
    analytics.track(forged);
    await settle();
    expect(sdk.captured()).toStrictEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('holds at most MAX_PENDING_EVENTS while the SDK starts', async () => {
    const sdk = createFakeAnalyticsSdk();
    const { analytics } = setup({ saved: granted, sdk });
    for (let index = 0; index < MAX_PENDING_EVENTS + 5; index += 1) analytics.track(CREATED);
    await settle();
    expect(sdk.captured()).toHaveLength(MAX_PENDING_EVENTS);
  });

  it('stays silent when the SDK fails, and stops for the session after a failed start', async () => {
    const { analytics, onError, createSdk } = setup({ saved: granted });
    createSdk.mockImplementation(() => {
      throw new Error('no native module');
    });
    expect(() => {
      analytics.track(CREATED);
    }).not.toThrow();
    await settle();
    analytics.track(CREATED);
    await settle();
    expect(createSdk).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('records a failing capture, flush or opt-out instead of throwing', async () => {
    for (const method of ['capture', 'flush', 'optOut'] as const) {
      const { analytics, onError } = setup({ saved: granted, sdk: createFakeAnalyticsSdk(method) });
      analytics.track(CREATED);
      await settle();
      await expect(analytics.flush()).resolves.toBeUndefined();
      analytics.setConsent('denied');
      await settle();
      expect(onError).toHaveBeenCalled();
    }
  });

  it('records an unreadable or unsaved consent record and treats it as no answer', async () => {
    const { analytics, onError, createSdk, store } = setup();
    jest
      .spyOn(store, 'read')
      .mockReturnValue({ ok: false, error: { kind: 'analytics-consent-unreadable' } });
    analytics.track(CREATED);
    await settle();
    expect(analytics.consent()).toBe('unknown');
    expect(createSdk).not.toHaveBeenCalled();
    jest
      .spyOn(store, 'write')
      .mockReturnValue({ ok: false, error: { kind: 'analytics-consent-not-saved' } });
    jest
      .spyOn(store, 'clear')
      .mockReturnValue({ ok: false, error: { kind: 'analytics-consent-not-saved' } });
    analytics.setConsent('granted');
    await analytics.forget();
    expect(onError).toHaveBeenCalledTimes(3);
  });
});
