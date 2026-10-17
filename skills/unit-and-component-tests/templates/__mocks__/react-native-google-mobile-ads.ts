// __mocks__/react-native-google-mobile-ads.ts — applied automatically to every Jest project (root
// manual mock for a node module). Only the AdMob adapters (src/services/ads/, src/services/consent/)
// import the library; a test that asserts on it calls jest.mock() + jest.requireMock(). Mirrors the
// 17.2.0 surface the adapters use.
type ConsentInfo = {
  status: 'UNKNOWN' | 'REQUIRED' | 'NOT_REQUIRED' | 'OBTAINED';
  canRequestAds: boolean;
  privacyOptionsRequirementStatus: 'UNKNOWN' | 'REQUIRED' | 'NOT_REQUIRED';
  isConsentFormAvailable: boolean;
};

const CONSENT_OBTAINED: ConsentInfo = {
  status: 'OBTAINED',
  canRequestAds: true,
  privacyOptionsRequirementStatus: 'NOT_REQUIRED',
  isConsentFormAvailable: false,
};

function createMockAd() {
  return {
    loaded: false,
    load: jest.fn(),
    show: jest.fn(() => Promise.resolve()),
    addAdEventListener: jest.fn(() => jest.fn()),
    removeAllListeners: jest.fn(),
    destroy: jest.fn(),
  };
}

const mobileAdsInstance = {
  initialize: jest.fn(() => Promise.resolve([])),
  setRequestConfiguration: jest.fn(() => Promise.resolve()),
  openAdInspector: jest.fn(() => Promise.resolve()),
};

// The library exports mobileAds() both as default and as MobileAds; the default forces this export.
const mobileAds = jest.fn(() => mobileAdsInstance);
export default mobileAds;
export const MobileAds = mobileAds;

export const AdsConsent = {
  requestInfoUpdate: jest.fn(() => Promise.resolve(CONSENT_OBTAINED)),
  loadAndShowConsentFormIfRequired: jest.fn(() => Promise.resolve(CONSENT_OBTAINED)),
  showPrivacyOptionsForm: jest.fn(() => Promise.resolve(CONSENT_OBTAINED)),
  getConsentInfo: jest.fn(() => Promise.resolve(CONSENT_OBTAINED)),
  getUserChoices: jest.fn(() => Promise.resolve({})),
  reset: jest.fn(),
};

export const AdsConsentStatus = {
  UNKNOWN: 'UNKNOWN',
  REQUIRED: 'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  OBTAINED: 'OBTAINED',
} as const;
export const AdsConsentPrivacyOptionsRequirementStatus = {
  UNKNOWN: 'UNKNOWN',
  REQUIRED: 'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
} as const;
export const AdsConsentDebugGeography = {
  DISABLED: 0,
  EEA: 1,
  NOT_EEA: 2,
  REGULATED_US_STATE: 3,
  OTHER: 4,
} as const;
export const MaxAdContentRating = { G: 'G', PG: 'PG', T: 'T', MA: 'MA' } as const;
export const AdEventType = {
  LOADED: 'loaded',
  ERROR: 'error',
  OPENED: 'opened',
  PAID: 'paid',
  CLICKED: 'clicked',
  CLOSED: 'closed',
  IMPRESSION: 'impression',
} as const;
export const RewardedAdEventType = {
  LOADED: 'rewarded_loaded',
  EARNED_REWARD: 'rewarded_earned_reward',
} as const;
export const BannerAdSize = {
  ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER',
  LARGE_ANCHORED_ADAPTIVE_BANNER: 'LARGE_ANCHORED_ADAPTIVE_BANNER',
} as const;

// iOS values of the library's TestIds (jest-expo/ios); keep in sync on every GMA upgrade.
export const TestIds = {
  ADAPTIVE_BANNER: 'ca-app-pub-3940256099942544/2435281174',
  BANNER: 'ca-app-pub-3940256099942544/2934735716',
  INTERSTITIAL: 'ca-app-pub-3940256099942544/4411468910',
  REWARDED: 'ca-app-pub-3940256099942544/1712485313',
  REWARDED_INTERSTITIAL: 'ca-app-pub-3940256099942544/6978759866',
} as const;

export const InterstitialAd = { createForAdRequest: jest.fn(createMockAd) };
export const RewardedAd = { createForAdRequest: jest.fn(createMockAd) };

export function BannerAd(): null {
  return null;
}
