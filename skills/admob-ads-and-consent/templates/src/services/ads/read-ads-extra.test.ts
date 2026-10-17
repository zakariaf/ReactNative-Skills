// src/services/ads/read-ads-extra.test.ts — expo.extra as app.config.ts writes it; anything
// unexpected turns ads off, and so does a manifest made for another variant's binary (an EAS Update
// published with the wrong environment).
import { manifestAppIds, readAdsExtra, readAdsExtraForBinary } from './read-ads-extra';

const IOS = {
  banner: 'ca-app-pub-1234567890123456/1111111111',
  interstitial: 'ca-app-pub-1234567890123456/2222222222',
  rewarded: 'ca-app-pub-1234567890123456/3333333333',
};
const ANDROID = {
  banner: 'ca-app-pub-1234567890123456/4444444444',
  interstitial: 'ca-app-pub-1234567890123456/5555555555',
  rewarded: 'ca-app-pub-1234567890123456/6666666666',
};
const LIVE = { adsMode: 'live', adUnits: { ios: IOS, android: ANDROID } };

/** A config (embedded or an update's manifest) made for the binary `appId`. */
function configFor(appId: string, extra: unknown): unknown {
  return { ios: { bundleIdentifier: appId }, android: { package: appId }, extra };
}

describe('readAdsExtra', () => {
  it('reads the mode and the live units of both platforms', () => {
    expect(readAdsExtra(LIVE)).toStrictEqual(LIVE);
  });

  it('turns ads off for a missing or unknown mode', () => {
    expect(readAdsExtra(undefined)).toStrictEqual({ adsMode: 'off', adUnits: null });
    expect(readAdsExtra({ adsMode: 'prod' })).toStrictEqual({ adsMode: 'off', adUnits: null });
  });

  it('ignores unit IDs of the wrong shape or for one platform only', () => {
    expect(readAdsExtra({ adsMode: 'test', adUnits: { ios: { banner: 1 } } })).toStrictEqual({
      adsMode: 'test',
      adUnits: null,
    });
    expect(readAdsExtra({ adsMode: 'live', adUnits: { ios: IOS } })).toStrictEqual({
      adsMode: 'live',
      adUnits: null,
    });
  });

  it('reads the running config by default', () => {
    expect(readAdsExtra().adsMode).toMatch(/^(off|test|live)$/);
  });
});

describe('readAdsExtraForBinary', () => {
  it("keeps the facts of a config made for this binary's app id", () => {
    expect(
      readAdsExtraForBinary('com.acme.tasks', configFor('com.acme.tasks', LIVE)),
    ).toStrictEqual(LIVE);
  });

  it('turns ads off for an update published with another variant environment', () => {
    // The production environment published to a preview channel: no live ads for testers.
    const toPreview = configFor('com.acme.tasks', LIVE);
    expect(readAdsExtraForBinary('com.acme.tasks.preview', toPreview)).toStrictEqual({
      adsMode: 'off',
      adUnits: null,
    });
    // A development shell published to production: no test ads in the store app.
    const toStore = configFor('com.acme.tasks.dev', { adsMode: 'test' });
    expect(readAdsExtraForBinary('com.acme.tasks', toStore)).toStrictEqual({
      adsMode: 'off',
      adUnits: null,
    });
  });

  it('trusts the config when the binary id is unknown', () => {
    expect(readAdsExtraForBinary(null, configFor('com.acme.tasks', LIVE))).toStrictEqual(LIVE);
  });

  it('reads the running config by default', () => {
    expect(readAdsExtraForBinary(null).adsMode).toMatch(/^(off|test|live)$/);
  });
});

describe('manifestAppIds', () => {
  it('lists the iOS bundle identifier and the Android package', () => {
    expect(manifestAppIds(configFor('com.acme.tasks', {}))).toStrictEqual([
      'com.acme.tasks',
      'com.acme.tasks',
    ]);
    expect(manifestAppIds(null)).toStrictEqual([]);
  });
});
