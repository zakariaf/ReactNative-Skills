// src/config/ads-config.test.ts — the variant x ads-mode matrix, and real IDs only in live builds.
import {
  admobPluginOptions,
  adsExtra,
  assertLiveIds,
  GOOGLE_SAMPLE_APP_IDS,
  resolveAdsMode,
} from './ads-config.ts';

import type { AdmobAppIds } from './ads-config.ts';

const PUB = '1234567890123456';
const LIVE: AdmobAppIds = {
  ios: {
    appId: `ca-app-pub-${PUB}~1234567890`,
    units: {
      banner: `ca-app-pub-${PUB}/1111111111`,
      interstitial: `ca-app-pub-${PUB}/2222222222`,
      rewarded: `ca-app-pub-${PUB}/3333333333`,
    },
  },
  android: {
    appId: `ca-app-pub-${PUB}~0987654321`,
    units: {
      banner: `ca-app-pub-${PUB}/4444444444`,
      interstitial: `ca-app-pub-${PUB}/5555555555`,
      rewarded: `ca-app-pub-${PUB}/6666666666`,
    },
  },
};

describe('resolveAdsMode', () => {
  it('defaults testing variants to test ads and production to live ads', () => {
    expect(resolveAdsMode({}, 'development')).toBe('test');
    expect(resolveAdsMode({ ADS_MODE: '' }, 'preview')).toBe('test');
    expect(resolveAdsMode({}, 'production')).toBe('live');
  });

  it('turns ads off in any variant', () => {
    expect(resolveAdsMode({ ADS_MODE: 'off' }, 'preview')).toBe('off');
    expect(resolveAdsMode({ ADS_MODE: 'off' }, 'production')).toBe('off');
  });

  it('refuses real ads in a testing variant, test ads in production, and unknown modes', () => {
    expect(() => resolveAdsMode({ ADS_MODE: 'live' }, 'development')).toThrow(/ADS_MODE=live/);
    expect(() => resolveAdsMode({ ADS_MODE: 'test' }, 'production')).toThrow(/ADS_MODE=test/);
    expect(() => resolveAdsMode({ ADS_MODE: 'LIVE' }, 'production')).toThrow(/not one of/);
  });
});

describe('admobPluginOptions', () => {
  it.each(['test', 'off'] as const)(
    "gives both platforms Google's sample app ID in %s builds",
    (mode) => {
      const options = admobPluginOptions(mode, LIVE, ['cstr6suwn9.skadnetwork']);
      expect(options).toStrictEqual({
        iosAppId: GOOGLE_SAMPLE_APP_IDS.ios,
        androidAppId: GOOGLE_SAMPLE_APP_IDS.android,
        delayAppMeasurementInit: true,
        skAdNetworkItems: ['cstr6suwn9.skadnetwork'],
      });
    },
  );

  it("uses the app's own IDs in live builds", () => {
    const options = admobPluginOptions('live', LIVE, []);
    expect([options.iosAppId, options.androidAppId]).toStrictEqual([
      LIVE.ios.appId,
      LIVE.android.appId,
    ]);
  });
});

describe('adsExtra', () => {
  it.each(['test', 'off'] as const)('leaves the unit IDs out of %s builds', (mode) => {
    expect(adsExtra(mode, LIVE)).toStrictEqual({ adsMode: mode });
  });

  it("embeds both platforms' units in live builds", () => {
    expect(adsExtra('live', LIVE)).toStrictEqual({
      adsMode: 'live',
      adUnits: { ios: LIVE.ios.units, android: LIVE.android.units },
    });
  });
});

describe('assertLiveIds', () => {
  it('rejects sample and malformed IDs', () => {
    expect(() => {
      assertLiveIds({ ...LIVE.ios, appId: GOOGLE_SAMPLE_APP_IDS.ios });
    }).toThrow(/invalid live AdMob ids/);
    expect(() => {
      assertLiveIds({ ...LIVE.ios, units: { ...LIVE.ios.units, banner: 'x' } });
    }).toThrow(/invalid live AdMob ids/);
  });

  it('accepts real IDs and the documented-format placeholders', () => {
    expect(() => {
      assertLiveIds(LIVE.android);
    }).not.toThrow();
    expect(() => {
      assertLiveIds({ ...LIVE.ios, appId: 'ca-app-pub-0000000000000000~0000000001' });
    }).not.toThrow();
  });
});
