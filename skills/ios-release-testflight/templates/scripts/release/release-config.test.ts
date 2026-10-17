// scripts/release/release-config.test.ts
import {
  appPrefix,
  parseReleaseConfig,
  releaseAdsMode,
  variantBundleId,
} from './release-config.ts';

describe('parseReleaseConfig', () => {
  it('fills every default around the one required key', () => {
    expect(parseReleaseConfig({ appId: 'com.acme.tasks' })).toStrictEqual({
      appId: 'com.acme.tasks',
      appDir: '.',
      releaseBranch: 'main',
      preflight: ['verify'],
      postPrebuild: [],
      usageStrings: [],
      usesNonExemptEncryption: null,
      forbiddenBundleStrings: [],
      unfinishedMarkers: [],
      productionAdsMode: 'live',
      whatToTest: { always: [], whenChanged: [] },
    });
  });

  it('takes the values the contract sets and ignores the keys only the checkers read', () => {
    const config = parseReleaseConfig({
      appId: 'com.acme.tasks',
      postPrebuild: ['audit:privacy'],
      usesNonExemptEncryption: false,
      whatToTest: {
        whenChanged: [{ paths: ['src/services/purchases/'], line: 'Buy, then Restore.' }],
      },
      adIdsFile: 'src/config/admob-ids.ts',
      productionAdsMode: 'off',
    });
    expect(config).toMatchObject({
      postPrebuild: ['audit:privacy'],
      usesNonExemptEncryption: false,
      productionAdsMode: 'off',
      whatToTest: { always: [], whenChanged: [{ line: 'Buy, then Restore.' }] },
    });
  });

  it('names the key that is wrong', () => {
    expect(() => parseReleaseConfig({ appId: 'tasks' })).toThrow(
      'appId: must be a reverse-DNS bundle id',
    );
    expect(() => parseReleaseConfig({ appId: 'com.acme.tasks', usageStrings: ['Camera'] })).toThrow(
      'usageStrings.0: must be NS*UsageDescription',
    );
  });
});

describe('variantBundleId and appPrefix', () => {
  it('gives each variant its own id, as app-variant.ts does', () => {
    expect(variantBundleId('com.acme.tasks', 'production')).toBe('com.acme.tasks');
    expect(variantBundleId('com.acme.tasks', 'preview')).toBe('com.acme.tasks.preview');
  });

  it('prefixes tags and commit scopes only when multi-package', () => {
    expect(appPrefix({ appDir: '.' })).toBe('');
    expect(appPrefix({ appDir: 'apps/mobile' })).toBe('mobile/');
  });
});

describe('releaseAdsMode', () => {
  const live = { productionAdsMode: 'live' } as const;
  const off = { productionAdsMode: 'off' } as const;

  it('exports off for a production build of an app that ships without ads', () => {
    expect(releaseAdsMode({ variant: 'production', adsMode: null }, off)).toBe('off');
  });

  it("keeps the app's default (exports nothing) for live production and for preview", () => {
    expect(releaseAdsMode({ variant: 'production', adsMode: null }, live)).toBeNull();
    expect(releaseAdsMode({ variant: 'preview', adsMode: null }, off)).toBeNull();
  });

  it('lets --ads win', () => {
    expect(releaseAdsMode({ variant: 'production', adsMode: 'live' }, off)).toBe('live');
  });
});
