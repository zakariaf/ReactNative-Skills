// consent-scenarios.mjs: check-ad-behaviour.mjs's scenarios for the consent module: the AdMob consent
// adapter (UMP, and its tracking option), the expo-tracking-transparency adapter (Apple's ATT
// request; general audience only) and createConsentPort, run against the stand-ins. Not an entry
// point.

import { reactNativeStub } from './stubs/react-native.mjs';
import { sdkStub } from './stubs/react-native-google-mobile-ads.mjs';
import { trackingStub } from './stubs/expo-tracking-transparency.mjs';

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** A promise that never settles would end the process silently: report it as a result instead. */
export const settled = (promise, ms = 200) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('never settled'), ms))]);

const CONSENT_REQUIRED = { status: 'REQUIRED', canRequestAds: false, privacyOptionsRequirementStatus: 'REQUIRED', isConsentFormAvailable: true };
const CONSENT_CACHED = { status: 'OBTAINED', canRequestAds: true, privacyOptionsRequirementStatus: 'NOT_REQUIRED', isConsentFormAvailable: false };

async function consentAdapterScenarios({ consentAdapter }, file, expect) {
  const fix = "Restore admob-consent-adapter.ts: map privacyOptionsRequirementStatus REQUIRED to the privacy entry, fall back to getConsentInfo() when a call fails, pass debugGeography only when set.";
  const refresh = async (answers, options = {}) => {
    sdkStub.reset(answers);
    const errors = [];
    const info = await settled(consentAdapter.createAdmobConsentAdapter({ tracking: null, ...options, onError: (error) => errors.push(String(error?.message ?? error)) }).refresh());
    return { info, errors, sdk: sdkStub.calls() };
  };
  await expect('consent-adapter', file, 'refresh where consent is required', () => refresh({ requestInfoUpdate: CONSENT_REQUIRED }), { info: { canRequestAds: false, isPrivacyOptionsRequired: true }, errors: [], sdk: ['AdsConsent.requestInfoUpdate:{}'] }, fix);
  await expect('consent-adapter', file, 'refresh offline falls back to the cached answer', () => refresh({ requestInfoUpdate: new Error('offline'), getConsentInfo: CONSENT_CACHED }), { info: { canRequestAds: true, isPrivacyOptionsRequired: false }, errors: ['offline'], sdk: ['AdsConsent.requestInfoUpdate:{}', 'AdsConsent.getConsentInfo'] }, fix);
  await expect('consent-adapter', file, 'debug geography EEA', async () => (await refresh({ requestInfoUpdate: CONSENT_REQUIRED }, { debugGeography: 'eea' })).sdk, ['AdsConsent.requestInfoUpdate:{"debugGeography":1}'], fix);
  await expect('consent-adapter', file, 'the form never resets consent', async () => {
    sdkStub.reset({ loadAndShowConsentFormIfRequired: CONSENT_CACHED });
    await settled(consentAdapter.createAdmobConsentAdapter({ tracking: null, onError: () => undefined }).showFormIfRequired());
    return sdkStub.calls();
  }, ['AdsConsent.loadAndShowConsentFormIfRequired'], fix);
  const trackingFix = "Restore requestTracking in admob-consent-adapter.ts: it asks through the tracking option (createExpoTrackingConsentAdapter) and answers 'unavailable' without asking when tracking is null (a child-directed app).";
  await expect('consent-adapter', file, 'tracking: null (child-directed) answers unavailable and asks nothing', async () => {
    trackingStub.reset({ status: 'undetermined' });
    reactNativeStub.reset();
    const status = await settled(consentAdapter.createAdmobConsentAdapter({ tracking: null, onError: () => undefined }).requestTracking());
    return { status, tracking: trackingStub.calls() };
  }, { status: 'unavailable', tracking: [] }, trackingFix);
  await expect('consent-adapter', file, "a general audience asks through the tracking option", async () => {
    const asked = [];
    const tracking = { requestTracking: async () => { asked.push('requestTracking'); return 'authorized'; } };
    const status = await settled(consentAdapter.createAdmobConsentAdapter({ tracking, onError: () => undefined }).requestTracking());
    return { status, asked };
  }, { status: 'authorized', asked: ['requestTracking'] }, trackingFix);
}

async function trackingScenarios({ trackingAdapter }, file, expect) {
  const fix = "Restore requestTracking in expo-tracking-consent-adapter.ts: off iOS 'unavailable' without touching the module; read the status first and ask (requestTrackingPermissionsAsync) only while it is undetermined and the app is active; map granted to authorized and denied (Expo also reports restricted so) to denied; a failure is logged and answers 'unavailable', never a rejection.";
  const ask = async ({ status = 'undetermined', answer = 'denied', fail = false, os = 'ios', appState = 'active', becomeActive = false } = {}) => {
    trackingStub.reset({ status, answer, fail });
    reactNativeStub.reset({ os, appState });
    const errors = [];
    const pending = trackingAdapter.createExpoTrackingConsentAdapter({ onError: (error) => errors.push(String(error?.message ?? error)) }).requestTracking();
    await tick();
    const beforeActive = trackingStub.calls();
    if (becomeActive) reactNativeStub.setAppState('active');
    const result = await settled(pending);
    return { result, errors, beforeActive, calls: trackingStub.calls() };
  };
  const both = ['getTrackingPermissionsAsync', 'requestTrackingPermissionsAsync'];
  await expect('tracking-adapter', file, 'not-determined: the system prompt, once, then the answer', () => ask(), { result: 'denied', errors: [], beforeActive: both, calls: both }, fix);
  await expect('tracking-adapter', file, 'an accepted prompt gives authorized', async () => (await ask({ answer: 'granted' })).result, 'authorized', fix);
  await expect('tracking-adapter', file, 'answered before: no prompt', () => ask({ status: 'denied' }), { result: 'denied', errors: [], beforeActive: ['getTrackingPermissionsAsync'], calls: ['getTrackingPermissionsAsync'] }, fix);
  await expect('tracking-adapter', file, 'in the background: waits for the app to be active', () => ask({ appState: 'background', becomeActive: true }), { result: 'denied', errors: [], beforeActive: ['getTrackingPermissionsAsync'], calls: both }, fix);
  await expect('tracking-adapter', file, 'a failing read resolves unavailable and is logged', () => ask({ fail: true }), { result: 'unavailable', errors: ['tracking module unavailable'], beforeActive: ['getTrackingPermissionsAsync'], calls: ['getTrackingPermissionsAsync'] }, fix);
  await expect('tracking-adapter', file, 'on Android: unavailable, the module untouched', () => ask({ os: 'android' }), { result: 'unavailable', errors: [], beforeActive: [], calls: [] }, fix);
}

async function consentFactoryScenarios({ consentAdapter, consentFactory, trackingAdapter }, file, expect) {
  const fix = 'Restore consent-factory.ts: ADS_MODE=off returns a port that never calls an SDK and never creates the adapter (canRequestAds false, no privacy entry, tracking unavailable); test and live call the adapter function the composition root passes.';
  const none = { canRequestAds: false, isPrivacyOptionsRequired: false };
  const admob = (options) => () => consentAdapter.createAdmobConsentAdapter({ tracking: trackingAdapter?.createExpoTrackingConsentAdapter({ onError: () => undefined }) ?? null, onError: () => undefined, ...options });
  await expect('consent-factory', file, 'ADS_MODE=off never asks Google UMP (a network request)', async () => {
    sdkStub.reset({ requestInfoUpdate: CONSENT_CACHED, loadAndShowConsentFormIfRequired: CONSENT_CACHED, showPrivacyOptionsForm: CONSENT_CACHED });
    let created = 0;
    const consent = consentFactory.createConsentPort('off', () => {
      created += 1;
      return admob({})();
    });
    const infos = [await settled(consent.refresh()), await settled(consent.showFormIfRequired()), await settled(consent.showPrivacyOptions())];
    return { infos, created, sdk: sdkStub.calls() };
  }, { infos: [none, none, none], created: 0, sdk: [] }, fix);
  await expect('consent-factory', file, "ADS_MODE=off never shows Apple's tracking prompt (every E2E build)", async () => {
    trackingStub.reset({ status: 'undetermined' });
    reactNativeStub.reset();
    const status = await settled(consentFactory.createConsentPort('off', admob({})).requestTracking());
    return { status, tracking: trackingStub.calls() };
  }, { status: 'unavailable', tracking: [] }, fix);
  await expect('consent-factory', file, 'ADS_MODE=test uses the AdMob consent adapter', async () => {
    sdkStub.reset({ requestInfoUpdate: CONSENT_CACHED });
    const info = await settled(consentFactory.createConsentPort('test', admob({ debugGeography: 'eea' })).refresh());
    return { info, sdk: sdkStub.calls() };
  }, { info: { canRequestAds: true, isPrivacyOptionsRequired: false }, sdk: ['AdsConsent.requestInfoUpdate:{"debugGeography":1}'] }, fix);
  await expect('consent-factory', file, 'ADS_MODE=live uses the AdMob consent adapter', async () => {
    sdkStub.reset({ requestInfoUpdate: CONSENT_REQUIRED });
    const info = await settled(consentFactory.createConsentPort('live', admob({})).refresh());
    return { info, sdk: sdkStub.calls() };
  }, { info: { canRequestAds: false, isPrivacyOptionsRequired: true }, sdk: ['AdsConsent.requestInfoUpdate:{}'] }, fix);
}

/** Every consent scenario whose modules loaded. */
export async function consentScenarios({ mods, files, expect }) {
  if (mods.consentAdapter) await consentAdapterScenarios(mods, files.consentAdapter, expect);
  if (mods.trackingAdapter) await trackingScenarios(mods, files.trackingAdapter, expect);
  if (mods.consentAdapter && mods.consentFactory) await consentFactoryScenarios(mods, files.consentFactory, expect);
}
