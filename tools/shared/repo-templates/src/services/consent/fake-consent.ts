// src/services/consent/fake-consent.ts
// Owned by the admob-ads-and-consent skill (canonical copy). A scripted ConsentPort for tests: it
// records every call in order and asks its "ATT prompt" only while the status is not-determined,
// like the real adapter.
import type { ConsentInfo, ConsentPort, TrackingStatus } from './consent-port';

/** What the fake answers. */
export type FakeConsentScript = {
  /** What refresh() answers. */
  readonly afterRefresh: ConsentInfo;
  /** What showFormIfRequired() and showPrivacyOptions() answer. */
  readonly afterForm: ConsentInfo;
  /** The ATT status at the start (default 'unavailable', as with ads off: nothing is asked). */
  readonly tracking?: TrackingStatus;
  /** The user's answer when the fake asks, that is while the status is 'not-determined'. */
  readonly trackingAnswer?: TrackingStatus;
  /** A call log shared with other fakes (fake-ads.ts), to prove the order across ports. */
  readonly log?: string[];
};

/** The scripted port, its call log and its prompt count. */
export type FakeConsent = ConsentPort & {
  /** The call log, in order ('refresh', 'showFormIfRequired', ..., 'requestTracking'). */
  readonly calls: () => readonly string[];
  /** How often the fake showed the system ATT prompt (Apple asks once, then never again). */
  readonly trackingPrompts: () => number;
};

/** A ConsentPort for tests that answers from `script`. */
export function createFakeConsent(script: FakeConsentScript): FakeConsent {
  const calls = script.log ?? [];
  let tracking = script.tracking ?? 'unavailable';
  let prompts = 0;
  const answer = (name: string, info: ConsentInfo): Promise<ConsentInfo> => {
    calls.push(name);
    return Promise.resolve(info);
  };
  return {
    refresh: () => answer('refresh', script.afterRefresh),
    showFormIfRequired: () => answer('showFormIfRequired', script.afterForm),
    showPrivacyOptions: () => answer('showPrivacyOptions', script.afterForm),
    // Like the adapter: the prompt only while not-determined, then the answer sticks.
    requestTracking: () => {
      calls.push('requestTracking');
      if (tracking === 'not-determined') {
        prompts += 1;
        tracking = script.trackingAnswer ?? 'denied';
      }
      return Promise.resolve(tracking);
    },
    calls: () => [...calls],
    trackingPrompts: () => prompts,
  };
}
