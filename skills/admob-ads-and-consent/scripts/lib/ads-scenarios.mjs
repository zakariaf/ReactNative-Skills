// ads-scenarios.mjs: check-ad-behaviour.mjs's scenarios for the ads module: the pure policy, the
// rewarded offer, the gate, the consent moment flow, the moments, the build config, the ads adapter
// against the SDK stand-in, the factory and read-ads-extra. Not an entry point.

import { settled, tick } from './consent-scenarios.mjs';
import { constantsStub } from './stubs/expo-constants.mjs';
import { sdkStub, TestIds } from './stubs/react-native-google-mobile-ads.mjs';

const CONFIG = { isAdsEnabled: true, minBreaksBeforeFirst: 3, minMsBetweenInterstitials: 180_000, minBreaksBetween: 2, bannerScreens: ['tasks', 'lists'] };
const READY = { isPremium: false, isOnline: true, canRequestAds: true, isOnboardingDone: true, breaksCompletedTotal: 10 };
const EMPTY = { lastInterstitialAtMs: null, breaksSinceInterstitial: 0, didLastInterstitialFollowFailure: false };
const T0 = 1_000_000_000;
const PUB = '1234567890123456';
const UNITS = { banner: `ca-app-pub-${PUB}/1111111111`, interstitial: `ca-app-pub-${PUB}/2222222222`, rewarded: `ca-app-pub-${PUB}/3333333333` };
const ANDROID_UNITS = { banner: `ca-app-pub-${PUB}/4444444444`, interstitial: `ca-app-pub-${PUB}/5555555555`, rewarded: `ca-app-pub-${PUB}/6666666666` };
const LIVE_IDS = { ios: { appId: `ca-app-pub-${PUB}~1234567890`, units: UNITS }, android: { appId: `ca-app-pub-${PUB}~0987654321`, units: ANDROID_UNITS } };
const SAMPLE = { ios: 'ca-app-pub-3940256099942544~1458002511', android: 'ca-app-pub-3940256099942544~3347511713' };

function fakeAds(calls, { interstitialResult = 'shown', rewardResult = 'rewarded', initialize } = {}) {
  return {
    // Resolves a tick later, like the SDK: a caller that preloads without awaiting it is caught.
    initialize: initialize ?? (async () => { calls.push('initialize'); await tick(); calls.push('initialized'); return { ok: true, value: true }; }),
    preloadInterstitial: () => { calls.push('preloadInterstitial'); },
    preloadRewarded: () => { calls.push('preloadRewarded'); },
    rewardedStatus: () => 'ready',
    subscribeRewardedStatus: () => () => undefined,
    showInterstitial: async () => { calls.push('showInterstitial'); return interstitialResult; },
    showRewarded: async () => { calls.push('showRewarded'); return rewardResult; },
    renderBanner: () => null,
  };
}

/** tracking: the ATT status; 'not-determined' shows the prompt (recorded) and answers `answer`. */
function fakeConsent(calls, afterRefresh, afterForm, { tracking = 'not-determined', answer = 'denied' } = {}) {
  let status = tracking;
  return {
    refresh: async () => { calls.push('refresh'); return afterRefresh; },
    showFormIfRequired: async () => { calls.push('showFormIfRequired'); return afterForm; },
    showPrivacyOptions: async () => { calls.push('showPrivacyOptions'); return afterForm; },
    requestTracking: async () => {
      if (status === 'not-determined') { calls.push('attPrompt'); status = answer; }
      return status;
    },
  };
}

const lifecycle = (calls) => ({ suspend: () => calls.push('suspend'), resume: () => calls.push('resume') });
const threw = (fn) => { try { fn(); return 'accepted'; } catch { return 'threw'; } };

async function policyScenarios({ policy, history }, files, expect) {
  const show = (req) => policy.shouldShowInterstitial({ config: CONFIG, context: READY, history: EMPTY, trigger: { outcome: 'success', nowMs: T0 }, ...req });
  const shownAtT0 = history.recordInterstitialShown({ nowMs: T0, outcome: 'success' });
  const two = history.recordBreak(history.recordBreak(shownAtT0, 'success'), 'success');
  const fix = 'Restore shouldShowInterstitial from the template: the numbers come from the config, both pacing conditions must hold, and no two interstitials in a row after failed breaks.';
  const cases = [
    ['first interstitial after 3 finished breaks', { context: { ...READY, breaksCompletedTotal: 3 } }, true],
    ['no interstitial before 3 finished breaks', { context: { ...READY, breaksCompletedTotal: 2 } }, false],
    ['Premium blocks it', { context: { ...READY, isPremium: true } }, false],
    ['offline blocks it', { context: { ...READY, isOnline: false } }, false],
    ['missing consent blocks it', { context: { ...READY, canRequestAds: false } }, false],
    ['onboarding blocks it', { context: { ...READY, isOnboardingDone: false } }, false],
    ['the master switch blocks it', { config: { ...CONFIG, isAdsEnabled: false } }, false],
    ['179 999 ms after the last one', { history: two, trigger: { outcome: 'success', nowMs: T0 + 179_999 } }, false],
    ['180 000 ms and 2 breaks after the last one', { history: two, trigger: { outcome: 'success', nowMs: T0 + 180_000 } }, true],
    ['only 1 break since the last one', { history: history.recordBreak(shownAtT0, 'success'), trigger: { outcome: 'success', nowMs: T0 + 999_999 } }, false],
    ['the same millisecond as the last one', { history: two, trigger: { outcome: 'success', nowMs: T0 } }, false],
    ['a second one in a row after failed breaks', { history: { ...two, didLastInterstitialFollowFailure: true }, trigger: { outcome: 'failure', nowMs: T0 + 999_999 } }, false],
    ['a success after a failure-triggered one', { history: { ...two, didLastInterstitialFollowFailure: true }, trigger: { outcome: 'success', nowMs: T0 + 999_999 } }, true],
    ['a last-shown time in the future is ignored', { history: two, trigger: { outcome: 'success', nowMs: T0 - 5 } }, true],
  ];
  for (const [label, req, want] of cases) await expect('interstitial-rules', files.policy, label, () => show(req), want, fix);
  const gentle = { ...CONFIG, minBreaksBeforeFirst: 5, minMsBetweenInterstitials: 60_000, minBreaksBetween: 1 };
  const numbersFix = 'Read every number from AdPolicyConfig; never hard-code 3, 180000 or 2.';
  await expect('interstitial-rules', files.policy, 'config minBreaksBeforeFirst=5 with 4 breaks', () => show({ config: gentle, context: { ...READY, breaksCompletedTotal: 4 } }), false, numbersFix);
  await expect('interstitial-rules', files.policy, 'config 60 000 ms / 1 break after the last one', () => show({ config: gentle, history: history.recordBreak(shownAtT0, 'success'), trigger: { outcome: 'success', nowMs: T0 + 60_000 } }), true, numbersFix);

  const bannerFix = 'Restore shouldShowBanner: canServeAds && onboarding done && the screen is in config.bannerScreens.';
  for (const screen of ['tasks', 'lists']) await expect('banner-rules', files.policy, `banner on ${screen}`, () => policy.shouldShowBanner(CONFIG, READY, screen), true, bannerFix);
  for (const screen of ['task-editor', 'paywall', 'settings', 'onboarding']) await expect('banner-rules', files.policy, `banner on ${screen}`, () => policy.shouldShowBanner(CONFIG, READY, screen), false, bannerFix);
  for (const [label, change] of [['Premium', { isPremium: true }], ['offline', { isOnline: false }], ['no consent', { canRequestAds: false }], ['onboarding running', { isOnboardingDone: false }]]) {
    await expect('banner-rules', files.policy, `banner while ${label}`, () => policy.shouldShowBanner(CONFIG, { ...READY, ...change }, 'tasks'), false, bannerFix);
  }
  await expect('banner-rules', files.policy, 'banner with the master switch off', () => policy.shouldShowBanner({ ...CONFIG, isAdsEnabled: false }, READY, 'tasks'), false, bannerFix);

  const historyFix = 'Restore ad-history.ts: successful breaks count, failed ones do not, a shown interstitial resets the counters.';
  await expect('ad-history', files.history, 'a successful break adds one', () => history.recordBreak(history.EMPTY_AD_HISTORY, 'success').breaksSinceInterstitial, 1, historyFix);
  await expect('ad-history', files.history, 'a failed break adds nothing', () => history.recordBreak(history.EMPTY_AD_HISTORY, 'failure'), EMPTY, historyFix);
  await expect('ad-history', files.history, 'a shown interstitial after a failed break', () => history.recordInterstitialShown({ nowMs: 7, outcome: 'failure' }), { lastInterstitialAtMs: 7, breaksSinceInterstitial: 0, didLastInterstitialFollowFailure: true }, historyFix);
}

async function offerScenarios({ offer }, files, expect) {
  const of = (perk, context, status) => offer.rewardedOffer(perk, { config: CONFIG, context, rewardedStatus: status });
  const passing = { isAvailable: true, freeAllowanceLeft: 0, waitsWhileLoading: false };
  const waiting = { isAvailable: true, freeAllowanceLeft: 0, waitsWhileLoading: true };
  const fix = "Restore rewardedOffer from the template: hidden when unavailable, free for Premium or a free use left, watch-ad when servable and the ad is ready, 'loading' for a perk that waits while its ad loads, hidden otherwise.";
  const cases = [
    ['a passing perk, ad ready', passing, READY, 'ready', 'watch-ad'],
    ['a passing perk, ad loading (it does not wait)', passing, READY, 'loading', 'hidden'],
    ['a passing perk, nothing can come', passing, READY, 'unavailable', 'hidden'],
    ['a free use left', { ...passing, freeAllowanceLeft: 1 }, READY, 'unavailable', 'free'],
    ['Premium offline', waiting, { ...READY, isPremium: true, isOnline: false }, 'unavailable', 'free'],
    ['a waiting perk, ad ready', waiting, READY, 'ready', 'watch-ad'],
    ['a waiting perk, ad loading (shown in its loading state)', waiting, READY, 'loading', 'loading'],
    ['a waiting perk, nothing can come (the flow moves on)', waiting, READY, 'unavailable', 'hidden'],
    ['offline, ad ready', waiting, { ...READY, isOnline: false }, 'ready', 'hidden'],
    ['offline, ad loading', waiting, { ...READY, isOnline: false }, 'loading', 'hidden'],
    ['no consent, ad ready', waiting, { ...READY, canRequestAds: false }, 'ready', 'hidden'],
    ['no consent, ad loading', waiting, { ...READY, canRequestAds: false }, 'loading', 'hidden'],
    ['an unavailable perk, even for Premium', { ...waiting, isAvailable: false }, { ...READY, isPremium: true }, 'ready', 'hidden'],
    ['an unavailable perk while loading', { ...waiting, isAvailable: false }, READY, 'loading', 'hidden'],
  ];
  for (const [label, perk, context, status, want] of cases) await expect('rewarded-offer-rules', files.offer, label, () => of(perk, context, status), want, fix);
}

async function gateScenarios({ gate }, files, expect) {
  const granted = { canRequestAds: true, isPrivacyOptionsRequired: true };
  const denied = { canRequestAds: false, isPrivacyOptionsRequired: true };
  const input = { isPremium: false, isAdsEnabled: true, isOnboardingDone: true, isOnline: true };
  // afterRefresh denied: a user where Google's form is required and not yet answered; 'attPrompt'
  // marks Apple's system prompt.
  const trace = async (fn, { afterRefresh = denied, afterForm = granted, tracking = 'not-determined', answer = 'denied' } = {}) => {
    const calls = [];
    const seen = [];
    const showIntro = async () => { calls.push('intro'); };
    const deps = { ads: fakeAds(calls), consent: fakeConsent(calls, afterRefresh, afterForm, { tracking, answer }), onConsent: (info) => seen.push(info), showIntro };
    const result = await fn(deps);
    return { calls, result, seen: seen.length };
  };
  const fix = "Restore ad-gate.ts: refresh, then (where the form is required) the primer, then Google's form; then Apple's ATT prompt (consent.requestTracking) once ads may be requested; only after onboarding, online and not Premium; initialize only when canRequestAds, whatever the ATT answer, and await it before any preload.";
  const ready = ['initialize', 'initialized', 'preloadInterstitial', 'preloadRewarded'];
  await expect('consent-order', files.gate, 'prepareAds with consent: primer, form, ATT, then initialize', () => trace((deps) => gate.prepareAds(deps, input)), { calls: ['refresh', 'intro', 'showFormIfRequired', 'attPrompt', ...ready], result: true, seen: 2 }, fix);
  await expect('consent-order', files.gate, 'prepareAds where consent is not required (no primer, no form, ATT still first)', () => trace((deps) => gate.prepareAds(deps, input), { afterRefresh: granted }), { calls: ['refresh', 'attPrompt', ...ready], result: true, seen: 1 }, fix);
  for (const [label, tracking] of [['ATT declined earlier', 'denied'], ['ATT restricted', 'restricted'], ['ATT unavailable', 'unavailable'], ['ATT authorized earlier', 'authorized']]) {
    await expect('consent-order', files.gate, `prepareAds with ${label}: ads still initialize, no prompt`, () => trace((deps) => gate.prepareAds(deps, input), { afterRefresh: granted, tracking }), { calls: ['refresh', ...ready], result: true, seen: 1 }, fix);
  }
  await expect('consent-order', files.gate, 'prepareAds when the user declines ATT now: ads still initialize', () => trace((deps) => gate.prepareAds(deps, input), { answer: 'denied' }), { calls: ['refresh', 'intro', 'showFormIfRequired', 'attPrompt', ...ready], result: true, seen: 2 }, fix);
  await expect('consent-order', files.gate, 'prepareAds when consent allows no ads (no ATT)', () => trace((deps) => gate.prepareAds(deps, input), { afterForm: denied }), { calls: ['refresh', 'intro', 'showFormIfRequired'], result: false, seen: 2 }, fix);
  for (const [label, change] of [['during onboarding', { isOnboardingDone: false }], ['for Premium', { isPremium: true }], ['offline', { isOnline: false }], ['with ads disabled', { isAdsEnabled: false }]]) {
    await expect('consent-order', files.gate, `prepareAds ${label} (no form, no ATT)`, () => trace((deps) => gate.prepareAds(deps, { ...input, ...change })), { calls: [], result: false, seen: 0 }, fix);
  }
  await expect('consent-order', files.gate, 'refreshConsentAtLaunch shows no form and no ATT', () => trace((deps) => gate.refreshConsentAtLaunch(deps, { ...input, isOnboardingDone: false })), { calls: ['refresh'], seen: 1 }, fix);
  await expect('consent-order', files.gate, 'refreshConsentAtLaunch for Premium', () => trace((deps) => gate.refreshConsentAtLaunch(deps, { ...input, isPremium: true })), { calls: [], seen: 0 }, fix);
}

async function flowScenarios({ flow }, files, expect) {
  const granted = { canRequestAds: true, isPrivacyOptionsRequired: false };
  const input = { isPremium: false, isAdsEnabled: true, isOnboardingDone: true, isOnline: true };
  const create = (calls, afterRefresh = granted, extra = {}) => flow.createConsentMomentFlow({ ads: fakeAds(calls), consent: fakeConsent(calls, afterRefresh, granted), hasPrimer: true, savedCanRequestAds: null, onConsent: () => undefined, onError: (error) => calls.push(`error:${String(error?.message ?? error)}`), ...extra });
  await expect('consent-moment-flow', files.flow, 'no ATT prompt while no ad screen is open (the user left for a task)', async () => {
    const calls = [];
    const moment = create(calls);
    moment.updateInput(input);
    const close = moment.requestAdMoment();
    close();
    moment.refreshAtLaunch();
    await tick();
    await tick();
    return calls;
  }, ['refresh'], 'Restore consent-moment-flow.ts: the ATT prompt (like the primer) waits until an ad screen is open, never over a focused task.');
  await expect('consent-moment-flow', files.flow, 'a screen pushed over the list gets no primer, form or ATT when the network returns', async () => {
    const calls = [];
    const moment = create(calls, { canRequestAds: false, isPrivacyOptionsRequired: true }, { hasPrimer: false });
    moment.updateInput({ ...input, isOnline: false }); // launched offline on the list
    const blurList = moment.requestAdMoment();
    await tick();
    blurList(); // a task editor is pushed; the list stays mounted below it
    moment.updateInput(input); // the network returns
    for (let step = 0; step < 4; step += 1) await tick();
    return { calls, isIntroShown: moment.getSnapshot().isIntroShown };
  }, { calls: [], isIntroShown: false }, 'Restore consent-moment-flow.ts: prepareAds runs only while an ad screen holds the moment (requestAdMoment until its release on blur); a closed gate that opens while no ad screen is focused waits for the next one.');
  await expect('consent-moment-flow', files.flow, 'banners are allowed only after the ATT answer and a finished initialize', async () => {
    const calls = [];
    const moment = create(calls);
    const allowedAfter = [];
    moment.subscribe(() => { if (moment.getSnapshot().canRequestAds === true) allowedAfter.push([...calls]); });
    moment.updateInput(input);
    moment.requestAdMoment();
    for (let step = 0; step < 4; step += 1) await tick();
    return allowedAfter;
  }, [['refresh', 'attPrompt', 'initialize', 'initialized', 'preloadInterstitial', 'preloadRewarded']], "Restore consent-moment-flow.ts: publish canRequestAds true only once prepareAds has finished (consent, the ATT answer, a finished initialize), never from the consent refresh; banner slots read it, so a banner would request an ad while Apple's prompt is up. A refusal is published at once.");
  await expect('consent-moment-flow', files.flow, 'facts that change while the gate decides are used (onboarding ended as the list opened)', async () => {
    const calls = [];
    const moment = create(calls, { canRequestAds: false, isPrivacyOptionsRequired: true });
    moment.updateInput({ ...input, isOnboardingDone: false });
    moment.requestAdMoment();
    moment.updateInput(input);
    await tick();
    await tick();
    return { calls, isIntroShown: moment.getSnapshot().isIntroShown };
  }, { calls: ['refresh'], isIntroShown: true }, "Restore consent-moment-flow.ts: when prepareAds ends without asking and the gate's facts changed meanwhile, decide again with the new facts.");
  await expect('consent-moment-flow', files.flow, "without a primer Google's form opens at once", async () => {
    const calls = [];
    const moment = create(calls, { canRequestAds: false, isPrivacyOptionsRequired: true }, { hasPrimer: false });
    moment.updateInput(input);
    moment.requestAdMoment();
    for (let step = 0; step < 4; step += 1) await tick();
    return { calls: calls.slice(0, 3), isIntroShown: moment.getSnapshot().isIntroShown };
  }, { calls: ['refresh', 'showFormIfRequired', 'attPrompt'], isIntroShown: false }, 'Restore consent-moment-flow.ts: with hasPrimer false, showIntro resolves at once (the moment still counts as asked).');
}

async function momentScenarios({ moments, fullscreen }, files, expect) {
  const request = { config: CONFIG, context: READY, history: EMPTY, trigger: { outcome: 'failure', nowMs: 42 } };
  const run1 = async (script, req = request) => {
    const calls = [];
    const result = await moments.showInterstitialIfDue({ ads: fakeAds(calls, script), lifecycle: lifecycle(calls) }, req);
    return { calls, result };
  };
  const fix = 'Restore ad-moments.ts and fullscreen-ad.ts: suspend -> show -> resume (in finally) -> preload; record the history only when shown.';
  const shown = ['suspend', 'showInterstitial', 'resume', 'preloadInterstitial'];
  await expect('fullscreen-lifecycle', files.moments, 'a due interstitial', () => run1({}), { calls: shown, result: { lastInterstitialAtMs: 42, breaksSinceInterstitial: 0, didLastInterstitialFollowFailure: true } }, fix);
  await expect('fullscreen-lifecycle', files.moments, 'an unavailable interstitial keeps the history', () => run1({ interstitialResult: 'unavailable' }), { calls: shown, result: EMPTY }, fix);
  await expect('fullscreen-lifecycle', files.moments, 'no interstitial when the policy says no', () => run1({}, { ...request, context: { ...READY, isPremium: true } }), { calls: [], result: EMPTY }, fix);
  for (const [rewardResult, want] of [['rewarded', true], ['dismissed', false], ['unavailable', false]]) {
    await expect('fullscreen-lifecycle', files.moments, `rewarded result "${rewardResult}"`, async () => {
      const calls = [];
      const granted = await moments.earnRewardedPerk({ ads: fakeAds(calls, { rewardResult }), lifecycle: lifecycle(calls) });
      return { calls, granted };
    }, { calls: ['suspend', 'showRewarded', 'resume', 'preloadRewarded'], granted: want }, fix);
  }
  await expect('fullscreen-lifecycle', files.fullscreen, 'media resumes even when showing throws', async () => {
    const calls = [];
    await fullscreen.runFullscreenAd(lifecycle(calls), async () => { calls.push('show'); throw new Error('boom'); }).catch(() => calls.push('rejected'));
    return calls;
  }, ['suspend', 'show', 'resume', 'rejected'], fix);
}

async function configScenarios({ config }, files, expect) {
  const fix = "Restore ads-config.ts: Google's sample app IDs and no units unless live; live IDs checked (format, Google's sample) on both platforms; no userTrackingUsageDescription.";
  for (const mode of ['test', 'off']) {
    await expect('ads-config', files.config, `${mode}: sample app IDs on both platforms`, () => { const options = config.admobPluginOptions(mode, LIVE_IDS, ['cstr6suwn9.skadnetwork']); return [options.iosAppId, options.androidAppId]; }, [SAMPLE.ios, SAMPLE.android], fix);
    await expect('ads-config', files.config, `${mode}: no unit IDs in expo.extra`, () => config.adsExtra(mode, LIVE_IDS), { adsMode: mode }, fix);
  }
  await expect('ads-config', files.config, "live: the app's own app IDs", () => { const options = config.admobPluginOptions('live', LIVE_IDS, []); return [options.iosAppId, options.androidAppId]; }, [LIVE_IDS.ios.appId, LIVE_IDS.android.appId], fix);
  await expect('ads-config', files.config, "live: both platforms' units", () => config.adsExtra('live', LIVE_IDS), { adsMode: 'live', adUnits: { ios: UNITS, android: ANDROID_UNITS } }, fix);
  await expect('ads-config', files.config, 'plugin options keys', () => Object.keys(config.admobPluginOptions('test', LIVE_IDS, [])).sort(), ['androidAppId', 'delayAppMeasurementInit', 'iosAppId', 'skAdNetworkItems'], fix);
  await expect('ads-config', files.config, 'delayAppMeasurementInit', () => config.admobPluginOptions('live', LIVE_IDS, []).delayAppMeasurementInit, true, fix);
  const sample = { ...LIVE_IDS, ios: { ...LIVE_IDS.ios, appId: SAMPLE.ios } };
  const malformed = { ...LIVE_IDS, ios: { ...LIVE_IDS.ios, units: { ...UNITS, banner: 'x' } } };
  await expect('ads-config', files.config, 'live with the sample app ID throws', () => threw(() => config.admobPluginOptions('live', sample, [])), 'threw', fix);
  await expect('ads-config', files.config, 'live with a sample unit ID in extra throws', () => threw(() => config.adsExtra('live', { ...LIVE_IDS, android: { ...LIVE_IDS.android, units: { ...ANDROID_UNITS, rewarded: 'ca-app-pub-3940256099942544/5224354917' } } })), 'threw', fix);
  await expect('ads-config', files.config, 'live with a malformed unit ID throws', () => threw(() => config.admobPluginOptions('live', malformed, [])), 'threw', fix);

  const modeFix = "Restore resolveAdsMode: development and preview default to test, production to live; ADS_MODE=live in a testing variant, ADS_MODE=test in production and unknown modes throw; off works everywhere.";
  const mode = (env, variant) => { try { return config.resolveAdsMode(env, variant); } catch { return 'threw'; } };
  await expect('ads-mode-matrix', files.config, 'defaults per variant', () => ['development', 'preview', 'production'].map((variant) => mode({}, variant)), ['test', 'test', 'live'], modeFix);
  await expect('ads-mode-matrix', files.config, 'ADS_MODE=off in every variant', () => ['development', 'preview', 'production'].map((variant) => mode({ ADS_MODE: 'off' }, variant)), ['off', 'off', 'off'], modeFix);
  for (const [variant, ads] of [['development', 'live'], ['preview', 'live'], ['production', 'test'], ['production', 'LIVE']]) {
    await expect('ads-mode-matrix', files.config, `APP_VARIANT=${variant} with ADS_MODE=${ads}`, () => mode({ ADS_MODE: ads }, variant), 'threw', modeFix);
  }
}

/** A fresh adapter over a reset SDK stand-in; errors reported to onAdError are collected. */
function freshAdapter(adapter, units = UNITS) {
  sdkStub.reset();
  const errors = [];
  const port = adapter.createAdmobAdsAdapter({ units, onAdError: (error) => errors.push(`${error.phase}:${error.reason}`) });
  return { port, errors };
}
/** An adapter after initialize (ads load only after it), with the SDK trace cleared. */
async function readyAdapter(adapter, units = UNITS) {
  const fresh = freshAdapter(adapter, units);
  await fresh.port.initialize();
  sdkStub.reset();
  return fresh;
}
const lastAd = (kind) => sdkStub.ads().filter((ad) => ad.kind === kind).at(-1);

/** Preload, fire LOADED, show, fire the given events, and return the result plus the SDK trace. */
async function showWith(port, kind, events) {
  if (kind === 'interstitial') port.preloadInterstitial();
  else port.preloadRewarded();
  const ad = lastAd(kind);
  sdkStub.emit(ad, kind === 'interstitial' ? 'loaded' : 'rewarded_loaded');
  const pending = kind === 'interstitial' ? port.showInterstitial() : port.showRewarded();
  await tick();
  for (const [type, payload] of events) sdkStub.emit(ad, type, payload);
  const result = await settled(pending);
  return { result, destroyed: ad.destroyed };
}

/** The request configuration the audience calls for, with sorted keys (as the stand-in records it). */
function expectedConfiguration(contract) {
  if (contract?.audience === 'child-directed') return { maxAdContentRating: 'G', tagForChildDirectedTreatment: true, tagForUnderAgeOfConsent: true };
  return { maxAdContentRating: contract?.maxAdContentRating ?? 'PG' };
}

async function adapterInitScenarios({ adapter }, file, expect, contract) {
  const initFix = 'Restore the template adapter: nothing touches the SDK until initialize(); initialize() sets the request configuration (contracts/ads.json audience), then initializes, once.';
  await expect('adapter-init', file, 'creating the adapter touches the SDK', () => { freshAdapter(adapter); return sdkStub.calls(); }, [], initFix);
  await expect('adapter-init', file, 'initialize() twice', async () => {
    const { port } = freshAdapter(adapter);
    await port.initialize();
    await port.initialize();
    return sdkStub.calls();
  }, [`setRequestConfiguration:${JSON.stringify(expectedConfiguration(contract))}`, 'initialize'], initFix);
  await expect('adapter-init', file, 'a failed initialize is recorded, answers a failure and is tried again', async () => {
    const { port, errors } = freshAdapter(adapter);
    sdkStub.failInitialize(1);
    const first = await settled(port.initialize());
    const second = await settled(port.initialize());
    return { first, second, errors: errors.length, initializes: sdkStub.calls().filter((call) => call === 'initialize').length };
  }, { first: { ok: false, error: { kind: 'ads-init-failed' } }, second: { ok: true, value: true }, errors: 1, initializes: 2 }, 'Restore initialize in the adapter: the SDK rejection is recorded (onAdError) and becomes { ok: false, error: { kind: \'ads-init-failed\' } } (attemptAsync), never a rejection; a failed run is forgotten so the next call tries again.');
  const testFix = "Read TestIds.ADAPTIVE_BANNER, TestIds.INTERSTITIAL and TestIds.REWARDED (units: 'test'); never type test IDs.";
  await expect('adapter-init', file, 'ADMOB_TEST_UNITS', () => adapter.ADMOB_TEST_UNITS, { banner: TestIds.ADAPTIVE_BANNER, interstitial: TestIds.INTERSTITIAL, rewarded: TestIds.REWARDED }, testFix);
  await expect('adapter-init', file, "units 'test' load Google's test units", async () => {
    const { port } = await readyAdapter(adapter, 'test');
    port.preloadInterstitial();
    return sdkStub.calls()[0];
  }, `interstitial.create:${TestIds.INTERSTITIAL}`, testFix);
}

async function adapterShowScenarios({ adapter }, file, expect) {
  const fsFix = 'Restore showInterstitial from the template: unavailable unless loaded; settle on CLOSED, on ERROR (a failed presentation sends no CLOSED) and on a rejected show(); destroy the ad.';
  await expect('adapter-interstitial', file, 'show before anything loaded', async () => {
    const { port } = await readyAdapter(adapter);
    port.preloadInterstitial();
    return { result: await settled(port.showInterstitial()), shows: sdkStub.calls().filter((c) => c.endsWith('.show')).length };
  }, { result: 'unavailable', shows: 0 }, fsFix);
  await expect('adapter-interstitial', file, 'preload uses the interstitial unit, once', async () => {
    const { port } = await readyAdapter(adapter);
    port.preloadInterstitial();
    port.preloadInterstitial();
    return sdkStub.calls();
  }, [`interstitial.create:${UNITS.interstitial}`, `interstitial.load:${UNITS.interstitial}`], fsFix);
  await expect('adapter-interstitial', file, 'shown, then closed', async () => showWith((await readyAdapter(adapter)).port, 'interstitial', [['closed']]), { result: 'shown', destroyed: true }, fsFix);
  await expect('adapter-interstitial', file, 'presentation fails (ERROR phase show, no CLOSED)', async () => {
    const { port, errors } = await readyAdapter(adapter);
    const outcome = await showWith(port, 'interstitial', [['error', { phase: 'show', reason: 'internal-error' }]]);
    return { ...outcome, errors };
  }, { result: 'unavailable', destroyed: true, errors: ['show:internal-error'] }, fsFix);
  await expect('adapter-interstitial', file, 'load-phase no-fill is silent and frees the slot', async () => {
    const { port, errors } = await readyAdapter(adapter);
    port.preloadInterstitial();
    sdkStub.emit(lastAd('interstitial'), 'error', { phase: 'load', reason: 'no-fill' });
    port.preloadInterstitial();
    return { errors, created: sdkStub.ads().length };
  }, { errors: [], created: 2 }, 'Only log load errors that are not no-fill; destroy the failed ad and clear its slot so the next quiet moment preloads again.');

  const rwFix = 'Restore showRewarded from the template: grant only after EARNED_REWARD; CLOSED alone is "dismissed"; ERROR or a rejected show() is "unavailable".';
  await expect('adapter-rewarded', file, 'closed without EARNED_REWARD', async () => showWith((await readyAdapter(adapter)).port, 'rewarded', [['closed']]), { result: 'dismissed', destroyed: true }, rwFix);
  await expect('adapter-rewarded', file, 'EARNED_REWARD, then closed', async () => showWith((await readyAdapter(adapter)).port, 'rewarded', [['rewarded_earned_reward', { type: 'reward', amount: 1 }], ['closed']]), { result: 'rewarded', destroyed: true }, rwFix);
  await expect('adapter-rewarded', file, 'presentation fails (ERROR phase show, no CLOSED)', async () => showWith((await readyAdapter(adapter)).port, 'rewarded', [['error', { phase: 'show', reason: 'internal-error' }]]), { result: 'unavailable', destroyed: true }, rwFix);
}

async function adapterStatusScenarios({ adapter }, file, expect) {
  const statusFix = "Restore the template's rewarded status: 'unavailable' before initialize (a preload then starts nothing), 'loading' from a preload until LOADED, 'ready' after LOADED, 'unavailable' once the ad is shown or after a load error until the next preload; tell subscribeRewardedStatus listeners each change.";
  await expect('adapter-rewarded-status', file, 'before initialize a preload starts nothing', async () => {
    const { port } = freshAdapter(adapter);
    port.preloadRewarded();
    return { status: port.rewardedStatus(), sdk: sdkStub.calls() };
  }, { status: 'unavailable', sdk: [] }, statusFix);
  await expect('adapter-rewarded-status', file, 'loading, ready, then unavailable once shown', async () => {
    const { port } = await readyAdapter(adapter);
    const seen = [];
    port.subscribeRewardedStatus(() => seen.push(port.rewardedStatus()));
    port.preloadRewarded();
    sdkStub.emit(lastAd('rewarded'), 'rewarded_loaded');
    const pending = port.showRewarded();
    await tick();
    sdkStub.emit(lastAd('rewarded'), 'closed');
    await settled(pending);
    return { seen, create: sdkStub.calls()[0] };
  }, { seen: ['loading', 'ready', 'unavailable'], create: `rewarded.create:${UNITS.rewarded}` }, statusFix);
  await expect('adapter-rewarded-status', file, 'a load error until the next preload', async () => {
    const { port } = await readyAdapter(adapter);
    port.preloadRewarded();
    sdkStub.emit(lastAd('rewarded'), 'error', { phase: 'load', reason: 'no-fill' });
    const afterError = port.rewardedStatus();
    port.preloadRewarded();
    return { afterError, again: port.rewardedStatus() };
  }, { afterError: 'unavailable', again: 'loading' }, statusFix);

  const bannerFix = 'renderBanner returns an element that draws createElement(BannerAd, { unitId: units.banner, size: BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER, onAdLoaded, onAdFailedToLoad }) only once initialize has finished (a component that reads the initialised flag with useSyncExternalStore and draws null before it): the native banner requests its ad as it mounts, and consent and the ATT answer come before initialize.';
  const drawBanner = (port) => {
    const onLoaded = () => undefined;
    const onFailed = () => undefined;
    let element = port.renderBanner({ onLoaded, onFailed });
    // Render function components (the stub hooks read current values) down to the SDK's view.
    for (let depth = 0; typeof element?.type === 'function' && element.type.name !== 'BannerAd' && depth < 5; depth += 1) element = element.type(element.props ?? {});
    const props = element?.props ?? {};
    return { type: element?.type?.name ?? null, unitId: props.unitId, size: props.size, loaded: props.onAdLoaded === onLoaded, failed: props.onAdFailedToLoad === onFailed };
  };
  await expect('adapter-banner', file, 'no banner view before initialize', () => drawBanner(freshAdapter(adapter).port).type, null, bannerFix);
  await expect('adapter-banner', file, 'renderBanner element after initialize', async () => drawBanner((await readyAdapter(adapter)).port), { type: 'BannerAd', unitId: UNITS.banner, size: 'LARGE_ANCHORED_ADAPTIVE_BANNER', loaded: true, failed: true }, bannerFix);
}

async function factoryScenarios({ factory }, file, expect) {
  const fix = "Restore createAdsPort: off -> a port that requests nothing and never calls createAdmob; test -> createAdmob('test'); live -> createAdmob(extra.adUnits[platform]) (throw when missing).";
  const recorder = () => {
    const made = [];
    return { made, createAdmob: (units) => { made.push(units); return fakeAds([]); } };
  };
  await expect('ads-factory', file, 'ADS_MODE=off requests nothing and shows nothing', async () => {
    const { made, createAdmob } = recorder();
    const port = factory.createAdsPort({ adsMode: 'off', adUnits: { ios: UNITS, android: ANDROID_UNITS } }, { platform: 'ios', createAdmob });
    await port.initialize();
    port.preloadInterstitial();
    port.preloadRewarded();
    return { interstitial: await settled(port.showInterstitial()), rewarded: await settled(port.showRewarded()), status: port.rewardedStatus(), made };
  }, { interstitial: 'unavailable', rewarded: 'unavailable', status: 'unavailable', made: [] }, fix);
  await expect('ads-factory', file, "ADS_MODE=test asks for Google's test units", () => { const { made, createAdmob } = recorder(); factory.createAdsPort({ adsMode: 'test', adUnits: null }, { platform: 'android', createAdmob }); return made; }, ['test'], fix);
  for (const [platform, units] of [['ios', UNITS], ['android', ANDROID_UNITS]]) {
    await expect('ads-factory', file, `ADS_MODE=live on ${platform} uses the ${platform} units`, () => { const { made, createAdmob } = recorder(); factory.createAdsPort({ adsMode: 'live', adUnits: { ios: UNITS, android: ANDROID_UNITS } }, { platform, createAdmob }); return made; }, [units], fix);
  }
  await expect('ads-factory', file, 'ADS_MODE=live without units', () => threw(() => factory.createAdsPort({ adsMode: 'live', adUnits: null }, { platform: 'ios', createAdmob: () => fakeAds([]) })), 'threw', fix);
}

async function extraScenarios({ extra }, file, expect) {
  const fix = "Restore readAdsExtra: anything unexpected falls back to 'off' and adUnits null; units only when both platforms have all three strings.";
  const both = { ios: UNITS, android: ANDROID_UNITS };
  const cases = [
    ['live with both platforms\' units', { adsMode: 'live', adUnits: both }, { adsMode: 'live', adUnits: both }],
    ['test without units', { adsMode: 'test' }, { adsMode: 'test', adUnits: null }],
    ['an unknown mode', { adsMode: 'LIVE', adUnits: both }, { adsMode: 'off', adUnits: both }],
    ['no extra at all', null, { adsMode: 'off', adUnits: null }],
    ['incomplete units', { adsMode: 'live', adUnits: { ios: { banner: UNITS.banner }, android: ANDROID_UNITS } }, { adsMode: 'live', adUnits: null }],
    ['one platform only', { adsMode: 'live', adUnits: { ios: UNITS } }, { adsMode: 'live', adUnits: null }],
  ];
  for (const [label, input, want] of cases) await expect('read-ads-extra', file, label, () => extra.readAdsExtra(input), want, fix);
  await expect('read-ads-extra', file, 'reads Constants.expoConfig.extra by default', () => {
    constantsStub.extra = { adsMode: 'test' };
    return extra.readAdsExtra();
  }, { adsMode: 'test', adUnits: null }, 'Default the argument to Constants.expoConfig?.extra (the running config).');
  const guardFix = "Restore readAdsExtraForBinary: read expo.extra of the running config (Constants.expoConfig by default), and turn ads off when the config's ios.bundleIdentifier / android.package does not name the binary's own id (Application.applicationId), so an EAS Update published with another variant's environment never changes this binary's ads mode or units.";
  const configFor = (appId, extraValue) => ({ ios: { bundleIdentifier: appId }, android: { package: appId }, extra: extraValue });
  const live = { adsMode: 'live', adUnits: both };
  const off = { adsMode: 'off', adUnits: null };
  const guardCases = [
    ['a config made for this binary keeps its facts', 'com.acme.tasks', configFor('com.acme.tasks', live), live],
    ['a production update on a preview binary serves no live ads', 'com.acme.tasks.preview', configFor('com.acme.tasks', live), off],
    ['a development update on the store binary serves no test ads', 'com.acme.tasks', configFor('com.acme.tasks.dev', { adsMode: 'test' }), off],
    ['an unknown binary id trusts the config', null, configFor('com.acme.tasks', live), live],
  ];
  for (const [label, nativeAppId, config, want] of guardCases) {
    await expect('read-ads-extra', file, label, () => {
      if (typeof extra.readAdsExtraForBinary !== 'function') return 'readAdsExtraForBinary is not exported';
      return extra.readAdsExtraForBinary(nativeAppId, config);
    }, want, guardFix);
  }
  await expect('read-ads-extra', file, 'readAdsExtraForBinary reads Constants.expoConfig by default', () => {
    if (typeof extra.readAdsExtraForBinary !== 'function') return 'readAdsExtraForBinary is not exported';
    constantsStub.config = configFor('com.acme.tasks', { adsMode: 'test' });
    try {
      return [extra.readAdsExtraForBinary('com.acme.tasks'), extra.readAdsExtraForBinary('com.acme.tasks.preview')];
    } finally {
      constantsStub.config = undefined;
    }
  }, [{ adsMode: 'test', adUnits: null }, off], guardFix);
}

/** Every ads scenario whose modules loaded. */
export async function adsScenarios({ mods, files, expect, contract }) {
  if (mods.policy && mods.history) await policyScenarios(mods, files, expect);
  if (mods.offer) await offerScenarios(mods, files, expect);
  if (mods.gate) await gateScenarios(mods, files, expect);
  if (mods.flow) await flowScenarios(mods, files, expect);
  if (mods.moments && mods.fullscreen) await momentScenarios(mods, files, expect);
  if (mods.config) await configScenarios(mods, files, expect);
  if (mods.adapter) {
    await adapterInitScenarios(mods, files.adapter, expect, contract);
    await adapterShowScenarios(mods, files.adapter, expect);
    await adapterStatusScenarios(mods, files.adapter, expect);
  }
  if (mods.factory) await factoryScenarios(mods, files.factory, expect);
  if (mods.extra) await extraScenarios(mods, files.extra, expect);
}
