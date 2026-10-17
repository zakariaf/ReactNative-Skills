// src/services/ads/consent-moment-flow.test.ts — the consent moment: primer, form, ATT and
// initialize only over an ad screen, once per session, retried when the facts change.
import { ok } from '@/core/result';
import { createFakeConsent } from '@/services/consent/fake-consent';
import { flushMicrotasks } from '@test/flush-microtasks';

import { createConsentMomentFlow } from './consent-moment-flow';
import { createFakeAds } from './fake-ads';

import type { AdGateInput } from './ad-gate';
import type { ConsentMomentFlow } from './consent-moment-flow';
import type { Result } from '@/core/result';
import type { ConsentInfo, ConsentPort } from '@/services/consent/consent-port';

const GRANTED: ConsentInfo = { canRequestAds: true, isPrivacyOptionsRequired: true };
const DENIED: ConsentInfo = { canRequestAds: false, isPrivacyOptionsRequired: true };
const READY: AdGateInput = {
  isPremium: false,
  isAdsEnabled: true,
  isOnboardingDone: true,
  isOnline: true,
};
const PREPARED = ['requestTracking', 'initialize', 'preloadInterstitial', 'preloadRewarded'];

type Setup = {
  readonly flow: ConsentMomentFlow;
  readonly calls: string[];
  readonly saved: ConsentInfo[];
  readonly errors: unknown[];
};

/**
 * afterRefresh DENIED: a user in a region where Google's form is required, not yet asked; on iOS
 * with the ATT answer still not-determined.
 */
function setup(
  script: { afterRefresh?: ConsentInfo; afterForm?: ConsentInfo; hasPrimer?: boolean } = {},
): Setup {
  const calls: string[] = [];
  const saved: ConsentInfo[] = [];
  const errors: unknown[] = [];
  const consent = createFakeConsent({
    afterRefresh: script.afterRefresh ?? DENIED,
    afterForm: script.afterForm ?? GRANTED,
    tracking: 'not-determined',
    log: calls,
  });
  const ads = createFakeAds({ rewardedStatus: 'unavailable', log: calls });
  const flow = createConsentMomentFlow({
    ads,
    consent,
    hasPrimer: script.hasPrimer ?? true,
    savedCanRequestAds: null,
    onConsent: (info) => {
      saved.push(info);
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  return { flow, calls, saved, errors };
}

describe('createConsentMomentFlow', () => {
  it('shows the primer over an ad screen, then the form, ATT, initialize and preload', async () => {
    const { flow, calls, saved } = setup();
    flow.updateInput(READY);
    flow.requestAdMoment();
    await flushMicrotasks();
    expect(flow.getSnapshot()).toStrictEqual({ isIntroShown: true, canRequestAds: false });
    expect(calls).toStrictEqual(['refresh']);
    flow.continueToForm();
    await flushMicrotasks();
    expect(flow.getSnapshot()).toStrictEqual({ isIntroShown: false, canRequestAds: true });
    expect(calls).toStrictEqual(['refresh', 'showFormIfRequired', ...PREPARED]);
    expect(saved).toStrictEqual([DENIED, GRANTED]);
  });

  it("opens Google's form at once when the app shows no primer", async () => {
    const { flow, calls } = setup({ hasPrimer: false });
    flow.updateInput(READY);
    flow.requestAdMoment();
    await flushMicrotasks();
    expect(flow.getSnapshot()).toStrictEqual({ isIntroShown: false, canRequestAds: true });
    expect(calls).toStrictEqual(['refresh', 'showFormIfRequired', ...PREPARED]);
  });

  it('shows no primer where consent is not required or was already given (ATT still first)', async () => {
    const { flow, calls } = setup({ afterRefresh: GRANTED });
    flow.updateInput(READY);
    flow.requestAdMoment();
    await flushMicrotasks();
    expect(flow.getSnapshot().isIntroShown).toBe(false);
    expect(calls).toStrictEqual(['refresh', ...PREPARED]);
  });

  // Consent, then Apple's prompt, then ads. Banner slots read canRequestAds from this snapshot, so
  // it turns true only once the ATT answer is in and the SDK is initialised: a banner mounted
  // earlier would request an ad while the prompt is still up.
  it('publishes canRequestAds only after the ATT answer and a finished initialize', async () => {
    const calls: string[] = [];
    const initializing: (() => void)[] = [];
    const fakeAds = createFakeAds({ rewardedStatus: 'unavailable', log: calls });
    const ads = {
      ...fakeAds,
      initialize: () =>
        new Promise<Result<true, never>>((resolve) => {
          calls.push('initialize');
          initializing.push(() => {
            resolve(ok(true));
          });
        }),
    };
    const consent = createFakeConsent({
      afterRefresh: GRANTED,
      afterForm: GRANTED,
      tracking: 'not-determined',
      log: calls,
    });
    const flow = createConsentMomentFlow({
      ...{ ads, consent, hasPrimer: true, savedCanRequestAds: null },
      ...{ onConsent: () => undefined, onError: () => undefined },
    });
    const callsWhenAllowed: string[][] = [];
    flow.subscribe(() => {
      if (flow.getSnapshot().canRequestAds === true) callsWhenAllowed.push([...calls]);
    });
    flow.updateInput(READY);
    flow.requestAdMoment();
    await flushMicrotasks();
    expect([calls, flow.getSnapshot().canRequestAds]).toStrictEqual([
      ['refresh', 'requestTracking', 'initialize'],
      null,
    ]);
    for (const finish of initializing) finish();
    await flushMicrotasks();
    expect(callsWhenAllowed).toStrictEqual([
      ['refresh', 'requestTracking', 'initialize', 'preloadInterstitial', 'preloadRewarded'],
    ]);
  });

  it('waits while no ad screen is open, so the primer never covers a focused task', async () => {
    const { flow } = setup();
    flow.updateInput(READY);
    const leaveTasks = flow.requestAdMoment();
    leaveTasks(); // the user opened a task before Google answered
    await flushMicrotasks();
    expect(flow.getSnapshot().isIntroShown).toBe(false);
    flow.requestAdMoment(); // back on the task list
    expect(flow.getSnapshot().isIntroShown).toBe(true);
  });

  it('asks ATT only over an ad screen: a user who left for a task is asked back on the list', async () => {
    const { flow, calls } = setup({ afterRefresh: GRANTED });
    flow.updateInput(READY);
    const leaveTasks = flow.requestAdMoment();
    leaveTasks(); // a task opened before Google answered: no prompt over it
    await flushMicrotasks();
    expect(calls).toStrictEqual(['refresh']);
    flow.requestAdMoment(); // back on the task list
    await flushMicrotasks();
    expect(calls).toStrictEqual(['refresh', ...PREPARED]);
  });

  it.each([
    ['during onboarding', { isOnboardingDone: false }],
    ['offline', { isOnline: false }],
    ['for Premium', { isPremium: true }],
    ['with ads off (ADS_MODE=off or the app switch)', { isAdsEnabled: false }],
  ] as const)('asks nothing, ATT included, %s', async (_label, change) => {
    const { flow, calls } = setup();
    flow.updateInput({ ...READY, ...change });
    flow.requestAdMoment();
    await flushMicrotasks();
    expect([calls, flow.getSnapshot().isIntroShown]).toStrictEqual([[], false]);
  });

  it('decides again when the facts change while the gate decides (onboarding ended as the list opened)', async () => {
    const { flow, calls } = setup();
    flow.updateInput({ ...READY, isOnboardingDone: false });
    flow.requestAdMoment(); // the list's banner slot asks first (child effects run first)
    flow.updateInput(READY); // then the moment hears that onboarding is done
    await flushMicrotasks();
    expect(calls).toStrictEqual(['refresh']);
    expect(flow.getSnapshot().isIntroShown).toBe(true);
  });

  it('tries again when the user comes online on an ad screen', async () => {
    const { flow, calls } = setup();
    flow.updateInput({ ...READY, isOnline: false });
    flow.requestAdMoment();
    await flushMicrotasks();
    flow.updateInput(READY);
    await flushMicrotasks();
    expect(calls).toStrictEqual(['refresh']);
    expect(flow.getSnapshot().isIntroShown).toBe(true);
  });

  it('asks once per session: an answer that allows no ads is not asked again', async () => {
    const { flow, calls } = setup({ afterForm: DENIED });
    flow.updateInput(READY);
    const release = flow.requestAdMoment();
    await flushMicrotasks();
    flow.continueToForm();
    await flushMicrotasks();
    release();
    flow.requestAdMoment();
    await flushMicrotasks();
    expect(calls).toStrictEqual(['refresh', 'showFormIfRequired']);
    expect(flow.getSnapshot()).toStrictEqual({ isIntroShown: false, canRequestAds: false });
  });

  it('refreshes consent once at launch when no moment is running, and logs failures', async () => {
    const { flow, calls, saved } = setup();
    flow.refreshAtLaunch(); // no facts yet: nothing
    flow.updateInput({ ...READY, isOnboardingDone: false });
    flow.refreshAtLaunch();
    await flushMicrotasks();
    expect([calls, saved]).toStrictEqual([['refresh'], [DENIED]]);
    const failing = setup();
    const broken: ConsentPort = {
      ...createFakeConsent({ afterRefresh: DENIED, afterForm: DENIED }),
      refresh: () => Promise.reject(new Error('offline')),
    };
    const flowWithError = createConsentMomentFlow({
      ads: createFakeAds({ rewardedStatus: 'unavailable' }),
      consent: broken,
      hasPrimer: true,
      savedCanRequestAds: true,
      onConsent: () => undefined,
      onError: (error) => {
        failing.errors.push(error);
      },
    });
    flowWithError.updateInput(READY);
    flowWithError.requestAdMoment();
    await flushMicrotasks();
    expect(failing.errors).toStrictEqual([new Error('offline')]);
    expect(flowWithError.getSnapshot()).toStrictEqual({ isIntroShown: false, canRequestAds: true });
  });

  it('tells its subscribers when the snapshot changes, and stops after unsubscribe', async () => {
    const { flow } = setup();
    const heard = jest.fn();
    const stop = flow.subscribe(heard);
    flow.updateInput(READY);
    flow.requestAdMoment();
    await flushMicrotasks();
    expect(heard).toHaveBeenCalled();
    stop();
    heard.mockClear();
    flow.continueToForm();
    await flushMicrotasks();
    expect(heard).not.toHaveBeenCalled();
  });
});
