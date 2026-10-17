// src/services/ads/admob-ads-adapter.test.ts — drives the ads adapter against the root __mocks__.
// Lint bans importing the SDK outside the adapters, so the test reads the mock with jest.requireMock
// (after an explicit jest.mock, so it is the instance the adapter imported).
import { act } from '@testing-library/react-native';
import { createElement, Fragment } from 'react';

import { renderWithProviders } from '@test/render-with-providers';

import { ADMOB_TEST_UNITS, createAdmobAdsAdapter } from './admob-ads-adapter';

import type { AdUnitIds } from './ads-port';

jest.mock('react-native-google-mobile-ads');

type Listener = (payload?: unknown) => void;
type MockAd = {
  loaded: boolean;
  readonly destroy: jest.Mock;
  readonly addAdEventListener: jest.Mock<() => void, [string, Listener]>;
};
type AdFactory = { readonly createForAdRequest: jest.Mock<MockAd, [string]> };
type MockedMobileAds = jest.Mock<{ readonly initialize: jest.Mock }, []>;
type BannerComponent = (props: { readonly unitId: string }) => null;
type MockedSdk = {
  readonly default: MockedMobileAds;
  readonly BannerAd: BannerComponent;
  readonly InterstitialAd: AdFactory;
  readonly RewardedAd: AdFactory;
  readonly AdEventType: { readonly CLOSED: string; readonly ERROR: string };
  readonly RewardedAdEventType: { readonly EARNED_REWARD: string; readonly LOADED: string };
};

const sdk = jest.requireMock<MockedSdk>('react-native-google-mobile-ads');

const UNITS: AdUnitIds = {
  banner: 'ca-app-pub-1234567890123456/1111111111',
  interstitial: 'ca-app-pub-1234567890123456/2222222222',
  rewarded: 'ca-app-pub-1234567890123456/3333333333',
};

function lastAd(factory: AdFactory): MockAd {
  const result = factory.createForAdRequest.mock.results.at(-1);
  if (result?.type !== 'return') throw new Error('no ad was created');
  return result.value;
}

// Fires one SDK event on the listeners the adapter registered.
function fire(ad: MockAd, type: string, payload?: unknown): void {
  ad.addAdEventListener.mock.calls
    .filter(([eventType]) => eventType === type)
    .forEach(([, listener]) => {
      listener(payload);
    });
}

/** The adapter after initialize (ads load only after it). */
async function initializedAds(): Promise<ReturnType<typeof createAdmobAdsAdapter>> {
  const ads = createAdmobAdsAdapter({ units: UNITS, onAdError: jest.fn() });
  await ads.initialize();
  return ads;
}

function loadedAd(factory: AdFactory, preload: () => void): MockAd {
  preload();
  const ad = lastAd(factory);
  ad.loaded = true; // what the SDK does on LOADED
  return ad;
}

describe('createAdmobAdsAdapter', () => {
  it("uses Google's test units when asked for them", async () => {
    const ads = createAdmobAdsAdapter({ units: 'test', onAdError: jest.fn() });
    await ads.initialize();
    ads.preloadInterstitial();

    expect(sdk.InterstitialAd.createForAdRequest).toHaveBeenLastCalledWith(
      ADMOB_TEST_UNITS.interstitial,
    );
  });

  it('settles "unavailable" when an interstitial fails to present (ERROR, no CLOSED)', async () => {
    const ads = await initializedAds();
    const ad = loadedAd(sdk.InterstitialAd, ads.preloadInterstitial);

    const shown = ads.showInterstitial();
    fire(ad, sdk.AdEventType.ERROR, { phase: 'show', reason: 'internal-error' });

    await expect(shown).resolves.toBe('unavailable');
    expect(ad.destroy).toHaveBeenCalled();
  });

  it('reports "shown" once the interstitial closes', async () => {
    const ads = await initializedAds();
    const ad = loadedAd(sdk.InterstitialAd, ads.preloadInterstitial);

    const shown = ads.showInterstitial();
    fire(ad, sdk.AdEventType.CLOSED);

    await expect(shown).resolves.toBe('shown');
  });

  it('grants a reward only after EARNED_REWARD', async () => {
    const ads = await initializedAds();
    const skipped = loadedAd(sdk.RewardedAd, ads.preloadRewarded);
    const dismissed = ads.showRewarded();
    fire(skipped, sdk.AdEventType.CLOSED);
    await expect(dismissed).resolves.toBe('dismissed');

    const watched = loadedAd(sdk.RewardedAd, ads.preloadRewarded);
    const rewarded = ads.showRewarded();
    fire(watched, sdk.RewardedAdEventType.EARNED_REWARD, { type: 'perk', amount: 1 });
    fire(watched, sdk.AdEventType.CLOSED);
    await expect(rewarded).resolves.toBe('rewarded');
  });

  it('shows nothing before an ad has loaded', async () => {
    const ads = await initializedAds();
    ads.preloadRewarded();

    await expect(ads.showRewarded()).resolves.toBe('unavailable');
    expect(ads.rewardedStatus()).toBe('loading');
  });
});

// No ad request before consent, the ATT answer and initialize. A banner slot may be allowed before
// that (the saved answer of the last session), so the native banner view, which requests its ad as
// it mounts, waits for the initialisation.
describe('renderBanner', () => {
  it('mounts no native banner before initialize, and mounts it once initialize has finished', async () => {
    const banner = jest.spyOn(sdk, 'BannerAd');
    const ads = createAdmobAdsAdapter({ units: UNITS, onAdError: jest.fn() });
    const view = ads.renderBanner({ onLoaded: jest.fn(), onFailed: jest.fn() });
    await renderWithProviders(createElement(Fragment, null, view));
    expect(banner).not.toHaveBeenCalled();
    await act(async () => {
      await ads.initialize();
    });
    expect(banner.mock.calls.at(-1)?.[0]).toMatchObject({ unitId: UNITS.banner });
  });
});

// prepareAds initialises the SDK once consent allows it, and a second caller (a reconnect, a banner
// screen) may ask while the first initialisation is still running: both wait for the one
// initialisation.
describe('initialize', () => {
  it('initialises the SDK once when two calls overlap', async () => {
    const ads = createAdmobAdsAdapter({ units: UNITS, onAdError: jest.fn() });
    const { initialize } = sdk.default();
    await Promise.all([ads.initialize(), ads.initialize()]);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('initialises once across calls made one after the other', async () => {
    const ads = await initializedAds();
    const { initialize } = sdk.default();
    await ads.initialize();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('records a failed initialisation, answers a failure and tries again on the next call', async () => {
    const onAdError = jest.fn();
    const ads = createAdmobAdsAdapter({ units: UNITS, onAdError });
    const { initialize } = sdk.default();
    const offline = new Error('offline');
    initialize.mockRejectedValueOnce(offline);
    await expect(ads.initialize()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'ads-init-failed' },
    });
    expect(onAdError).toHaveBeenCalledWith(offline);
    await expect(ads.initialize()).resolves.toStrictEqual({ ok: true, value: true });
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});

describe('rewardedStatus', () => {
  it('is unavailable before initialize, and a preload before it starts nothing', () => {
    const ads = createAdmobAdsAdapter({ units: UNITS, onAdError: jest.fn() });
    const created = sdk.RewardedAd.createForAdRequest.mock.calls.length;
    ads.preloadRewarded();
    expect(ads.rewardedStatus()).toBe('unavailable');
    expect(sdk.RewardedAd.createForAdRequest.mock.calls).toHaveLength(created);
  });

  it('is loading from the preload until LOADED, then ready; subscribers hear each change', async () => {
    const ads = await initializedAds();
    const heard: string[] = [];
    const stop = ads.subscribeRewardedStatus(() => heard.push(ads.rewardedStatus()));
    ads.preloadRewarded();
    expect(ads.rewardedStatus()).toBe('loading');
    fire(lastAd(sdk.RewardedAd), sdk.RewardedAdEventType.LOADED);
    expect(ads.rewardedStatus()).toBe('ready');
    stop();
    expect(heard).toStrictEqual(['loading', 'ready']);
  });

  it('is unavailable after a load error until the next preload starts', async () => {
    const onAdError = jest.fn();
    const ads = createAdmobAdsAdapter({ units: UNITS, onAdError });
    await ads.initialize();
    ads.preloadRewarded();
    fire(lastAd(sdk.RewardedAd), sdk.AdEventType.ERROR, { phase: 'load', reason: 'no-fill' });
    expect(ads.rewardedStatus()).toBe('unavailable');
    expect(onAdError).not.toHaveBeenCalled(); // no-fill is routine inventory
    ads.preloadRewarded();
    expect(ads.rewardedStatus()).toBe('loading');
  });

  it('is unavailable once the loaded ad is shown, until ad-moments preloads the next', async () => {
    const ads = await initializedAds();
    const ad = loadedAd(sdk.RewardedAd, ads.preloadRewarded);
    fire(ad, sdk.RewardedAdEventType.LOADED);
    const shown = ads.showRewarded();
    expect(ads.rewardedStatus()).toBe('unavailable');
    fire(ad, sdk.AdEventType.CLOSED);
    await expect(shown).resolves.toBe('dismissed');
  });
});
