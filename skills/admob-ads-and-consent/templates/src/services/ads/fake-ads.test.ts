// src/services/ads/fake-ads.test.ts — the fake behaves like the port: scripted answers, a call log,
// and a rewarded status whose subscribers hear every change.
import { createFakeAds } from './fake-ads';

describe('createFakeAds', () => {
  it('answers the scripted rewarded status and tells subscribers when a test moves it', () => {
    const ads = createFakeAds({ rewardedStatus: 'loading' });
    const heard: string[] = [];
    const stop = ads.subscribeRewardedStatus(() => heard.push(ads.rewardedStatus()));
    expect(ads.rewardedStatus()).toBe('loading');
    ads.setRewardedStatus('ready');
    stop();
    ads.setRewardedStatus('unavailable');
    expect(heard).toStrictEqual(['ready']);
    expect(ads.rewardedStatus()).toBe('unavailable');
  });

  it('records the calls it gets and resolves the scripted results', async () => {
    const ads = createFakeAds({ interstitialResult: 'unavailable', rewardResult: 'dismissed' });
    await ads.initialize();
    ads.preloadInterstitial();
    ads.preloadRewarded();
    await expect(ads.showInterstitial()).resolves.toBe('unavailable');
    await expect(ads.showRewarded()).resolves.toBe('dismissed');
    expect(ads.renderBanner({ onLoaded: jest.fn(), onFailed: jest.fn() })).toBeNull();
    expect(ads.calls()).toStrictEqual([
      'initialize',
      'preloadInterstitial',
      'preloadRewarded',
      'showInterstitial',
      'showRewarded',
    ]);
  });

  it('shows and rewards by default', async () => {
    const ads = createFakeAds();

    expect(ads.rewardedStatus()).toBe('ready');
    await expect(ads.showInterstitial()).resolves.toBe('shown');
    await expect(ads.showRewarded()).resolves.toBe('rewarded');
  });
});
