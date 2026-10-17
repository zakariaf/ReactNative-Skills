// Scripted stand-in for react-native-google-mobile-ads 17.2.0, used only by check-ad-behaviour.mjs
// (load-ts.mjs resolves the SDK to this file). It records every SDK call in order and lets the
// checker fire ad events, so the repo's own adapters can be run under Node. Not an entry point.
// Enum values match the 17.2.0 sources; TestIds are the iOS values.

const state = { calls: [], ads: [], consent: {}, initFailures: 0 };

const record = (entry) => {
  state.calls.push(entry);
};

export const sdkStub = {
  reset(consent = {}) {
    state.calls.length = 0;
    state.ads.length = 0;
    state.consent = consent;
    state.initFailures = 0;
  },
  /** The next `count` initialize() calls reject, as the native module does offline. */
  failInitialize(count) {
    state.initFailures = count;
  },
  calls: () => [...state.calls],
  ads: () => [...state.ads],
  /** Fire one ad event the way the SDK does: LOADED marks the ad loaded, then listeners run. */
  emit(ad, type, payload) {
    if (ad.destroyed) return;
    if (type === 'loaded' || type === 'rewarded_loaded') ad.loaded = true;
    if (type === 'closed' || type === 'error') ad.loaded = false;
    for (const listener of [...(ad.listeners.get(type) ?? [])]) listener(payload);
  },
};

/** The configuration with sorted keys, so a trace compares whatever order the app wrote. */
const sorted = (config) => Object.fromEntries(Object.entries(config ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));

const instance = {
  setRequestConfiguration: async (config) => {
    record(`setRequestConfiguration:${JSON.stringify(sorted(config))}`);
  },
  initialize: async () => {
    record('initialize');
    if (state.initFailures > 0) {
      state.initFailures -= 1;
      throw new Error('initialization failed');
    }
    return [];
  },
  openAdInspector: async () => {
    record('openAdInspector');
  },
};

export default function mobileAds() {
  return instance;
}
export const MobileAds = mobileAds;

export const AdEventType = { LOADED: 'loaded', ERROR: 'error', OPENED: 'opened', PAID: 'paid', CLICKED: 'clicked', CLOSED: 'closed', IMPRESSION: 'impression' };
export const RewardedAdEventType = { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' };
export const MaxAdContentRating = { G: 'G', PG: 'PG', T: 'T', MA: 'MA' };
export const BannerAdSize = { BANNER: 'BANNER', ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER', LARGE_ANCHORED_ADAPTIVE_BANNER: 'LARGE_ANCHORED_ADAPTIVE_BANNER' };
export const TestIds = {
  ADAPTIVE_BANNER: 'ca-app-pub-3940256099942544/2435281174',
  BANNER: 'ca-app-pub-3940256099942544/2934735716',
  INTERSTITIAL: 'ca-app-pub-3940256099942544/4411468910',
  REWARDED: 'ca-app-pub-3940256099942544/1712485313',
};

export function BannerAd() {
  return null;
}

function createAd(kind, unitId) {
  const ad = {
    kind,
    unitId,
    loaded: false,
    destroyed: false,
    listeners: new Map(),
    addAdEventListener(type, listener) {
      if (ad.destroyed) throw new Error(`${kind}.addAdEventListener on a destroyed ad`);
      const list = ad.listeners.get(type) ?? [];
      list.push(listener);
      ad.listeners.set(type, list);
      return () => ad.listeners.set(type, (ad.listeners.get(type) ?? []).filter((item) => item !== listener));
    },
    load() {
      record(`${kind}.load:${unitId}`);
    },
    // Like 17.2.0: throws on a destroyed ad, rejects when not loaded, otherwise resolves at once
    // (the native present call resolves before the ad is dismissed or fails to present).
    show() {
      if (ad.destroyed) throw new Error(`${kind}.show() on a destroyed ad`);
      record(`${kind}.show`);
      return ad.loaded ? Promise.resolve() : Promise.reject(new Error(`${kind} has not loaded`));
    },
    destroy() {
      if (ad.destroyed) return;
      ad.destroyed = true;
      ad.loaded = false;
      ad.listeners.clear();
      record(`${kind}.destroy`);
    },
    removeAllListeners() {
      ad.listeners.clear();
    },
  };
  state.ads.push(ad);
  record(`${kind}.create:${unitId}`);
  return ad;
}

export const InterstitialAd = { createForAdRequest: (unitId) => createAd('interstitial', unitId) };
export const RewardedAd = { createForAdRequest: (unitId) => createAd('rewarded', unitId) };

export const AdsConsentStatus = { UNKNOWN: 'UNKNOWN', REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED', OBTAINED: 'OBTAINED' };
export const AdsConsentPrivacyOptionsRequirementStatus = { UNKNOWN: 'UNKNOWN', REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED' };
export const AdsConsentDebugGeography = { DISABLED: 0, EEA: 1, NOT_EEA: 2, REGULATED_US_STATE: 3, OTHER: 4 };

/** Each consent call answers from sdkStub.reset({ <method>: info | Error }); an Error rejects. */
function consentCall(name, args) {
  record(`AdsConsent.${name}${args.length > 0 ? `:${JSON.stringify(args[0])}` : ''}`);
  const answer = state.consent[name];
  if (answer instanceof Error) return Promise.reject(answer);
  return Promise.resolve(answer ?? { status: 'UNKNOWN', canRequestAds: false, privacyOptionsRequirementStatus: 'UNKNOWN', isConsentFormAvailable: false });
}

export const AdsConsent = {
  requestInfoUpdate: (...args) => consentCall('requestInfoUpdate', args),
  loadAndShowConsentFormIfRequired: (...args) => consentCall('loadAndShowConsentFormIfRequired', args),
  showPrivacyOptionsForm: (...args) => consentCall('showPrivacyOptionsForm', args),
  getConsentInfo: (...args) => consentCall('getConsentInfo', args),
  gatherConsent: (...args) => consentCall('gatherConsent', args),
  getUserChoices: async () => {
    record('AdsConsent.getUserChoices');
    return {};
  },
  reset: () => {
    record('AdsConsent.reset');
  },
};
