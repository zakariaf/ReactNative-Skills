// src/services/ads/ads-factory.test.ts — off builds get a port that requests nothing; test builds
// Google's test units; live builds this platform's own units.
import { createAdsPort } from './ads-factory';
import { createFakeAds } from './fake-ads';

import type { AdUnitIds } from './ads-port';

const IOS: AdUnitIds = {
  banner: 'ca-app-pub-1234567890123456/1111111111',
  interstitial: 'ca-app-pub-1234567890123456/2222222222',
  rewarded: 'ca-app-pub-1234567890123456/3333333333',
};
const ANDROID: AdUnitIds = {
  banner: 'ca-app-pub-1234567890123456/4444444444',
  interstitial: 'ca-app-pub-1234567890123456/5555555555',
  rewarded: 'ca-app-pub-1234567890123456/6666666666',
};

describe('createAdsPort', () => {
  it('returns a port that never shows or creates anything when ADS_MODE=off', async () => {
    const createAdmob = jest.fn(() => createFakeAds());
    const ads = createAdsPort({ adsMode: 'off', adUnits: null }, { platform: 'ios', createAdmob });

    await ads.initialize();
    ads.preloadInterstitial();
    ads.preloadRewarded();
    await expect(ads.showInterstitial()).resolves.toBe('unavailable');
    await expect(ads.showRewarded()).resolves.toBe('unavailable');
    // With ads off the rewarded ad can never come, so an offer that waits for it is hidden.
    expect(ads.rewardedStatus()).toBe('unavailable');
    expect(ads.renderBanner({ onLoaded: jest.fn(), onFailed: jest.fn() })).toBeNull();
    expect(createAdmob).not.toHaveBeenCalled();
  });

  it("asks for Google's test units when ADS_MODE=test", () => {
    const createAdmob = jest.fn(() => createFakeAds());
    createAdsPort({ adsMode: 'test', adUnits: null }, { platform: 'android', createAdmob });

    expect(createAdmob).toHaveBeenCalledWith('test');
  });

  it.each([
    ['ios', IOS],
    ['android', ANDROID],
  ] as const)('uses the %s units when ADS_MODE=live', (platform, units) => {
    const createAdmob = jest.fn(() => createFakeAds());
    const adUnits = { ios: IOS, android: ANDROID };
    createAdsPort({ adsMode: 'live', adUnits }, { platform, createAdmob });

    expect(createAdmob).toHaveBeenCalledWith(units);
  });

  it('refuses live mode without unit IDs', () => {
    const options = { platform: 'ios', createAdmob: () => createFakeAds() } as const;

    expect(() => createAdsPort({ adsMode: 'live', adUnits: null }, options)).toThrow(
      /expo.extra.adUnits.ios/,
    );
  });
});
