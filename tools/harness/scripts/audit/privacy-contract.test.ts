// scripts/audit/privacy-contract.test.ts
import {
  declaredPods,
  declaredSdkNames,
  matchesAnyGlob,
  networkSeams,
  parsePrivacyContract,
  trackingPods,
  urlSeams,
} from './privacy-contract.ts';

const ADS = {
  pods: ['Google-Mobile-Ads-SDK', 'GoogleUserMessagingPlatform'],
  tracking: true,
  why: 'banner ads on the task list',
};

describe('parsePrivacyContract', () => {
  it('reads the profile, the seams and the declared SDKs', () => {
    const contract = parsePrivacyContract({
      profile: 'api-port',
      networkModules: ['src/services/file-transfer/*-adapter.ts'],
      linkFiles: ['src/config/external-links.ts'],
      sdks: {
        'react-native-google-mobile-ads': ADS,
        'expo-iap': { pods: ['openiap'], why: 'Premium' },
      },
    });

    expect(networkSeams(contract)).toStrictEqual([
      'src/api/**',
      'src/services/file-transfer/*-adapter.ts',
    ]);
    expect(urlSeams(contract)).toStrictEqual(['src/config/**', 'src/config/external-links.ts']);
    expect([...declaredSdkNames(contract)]).toStrictEqual([
      'react-native-google-mobile-ads',
      'expo-iap',
    ]);
    expect([...declaredPods(contract)]).toStrictEqual([...ADS.pods, 'openiap']);
    expect([...trackingPods(contract)]).toStrictEqual(ADS.pods);
  });

  it('gives an offline-only app no network seam and only its link files for URLs', () => {
    const contract = parsePrivacyContract({
      profile: 'offline-only',
      linkFiles: ['src/config/links.ts'],
      sdks: {},
    });

    expect(networkSeams(contract)).toStrictEqual([]);
    expect(urlSeams(contract)).toStrictEqual(['src/config/links.ts']);
  });

  it('refuses an unknown profile, networkModules offline, and a broken sdks entry', () => {
    expect(() => parsePrivacyContract({ profile: 'mostly-offline' })).toThrow(
      'is not one of api-port, offline-only',
    );
    expect(() =>
      parsePrivacyContract({ profile: 'offline-only', networkModules: ['src/x.ts'] }),
    ).toThrow('allows no networkModules');
    expect(() => parsePrivacyContract({ sdks: { 'expo-iap': { pods: 'openiap' } } })).toThrow(
      'must be a list of strings',
    );
  });
});

describe('matchesAnyGlob', () => {
  it('matches folders recursively and files exactly', () => {
    expect(matchesAnyGlob('src/api/tasks/tasks-queries.ts', ['src/api/**'])).toBe(true);
    expect(
      matchesAnyGlob('src/features/tasks/tasks-screen.tsx', ['src/api/**', 'src/config/links.ts']),
    ).toBe(false);
  });
});
