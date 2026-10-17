// scripts/release/store-gate.test.ts
import { SAMPLE_IOS_APP_ID, storeGateProblems } from './store-gate.ts';

import type { ArtifactFacts, GateExpectation } from './store-gate.ts';

const UNFILLED = ['__', 'API_URL', '__'].join('');
const LIVE_ID = 'ca-app-pub-1234567890123456~6543210987';

const FACTS: ArtifactFacts = {
  info: {
    CFBundleShortVersionString: '1.4.0',
    CFBundleVersion: '14',
    CFBundleIdentifier: 'com.acme.tasks',
    DTXcode: '2660',
    DTPlatformName: 'iphoneos',
    GADApplicationIdentifier: LIVE_ID,
    ITSAppUsesNonExemptEncryption: false,
  },
  appConfig: {
    ios: { bundleIdentifier: 'com.acme.tasks' },
    extra: { appVariant: 'production', adsMode: 'live' },
  },
  strings: [{ where: 'Info.plist CFBundleIdentifier', value: 'com.acme.tasks' }],
  bundleCounts: { TASKS_TEST_BUILD_ONLY: 0, 'placeholder.screen': 0 },
  testArtefacts: [],
  hasPrivacyManifest: true,
  getTaskAllow: false,
  missingUsageStrings: [],
};

const WANT: GateExpectation = {
  variant: 'production',
  adsMode: 'live',
  version: '1.4.0',
  buildNumber: 14,
  bundleId: 'com.acme.tasks',
  xcodeBuild: '2660',
  sentinels: ['TASKS_TEST_BUILD_ONLY'],
  forbiddenStrings: ['placeholder.screen'],
  usesNonExemptEncryption: false,
};

const withInfo = (info: Record<string, unknown>): ArtifactFacts => ({
  ...FACTS,
  info: { ...FACTS.info, ...info },
});

describe('storeGateProblems', () => {
  it('passes a clean production build', () => {
    expect(storeGateProblems(FACTS, WANT)).toStrictEqual([]);
  });

  it('refuses a stale build number, another Xcode and a simulator build', () => {
    const facts = withInfo({
      CFBundleVersion: '13',
      DTXcode: '2700',
      DTPlatformName: 'iphonesimulator',
    });
    expect(storeGateProblems(facts, WANT)).toStrictEqual([
      'CFBundleVersion is 13, not the new build number 14',
      'DTXcode is 2700, not 2660 (the pinned Xcode)',
      'DTPlatformName is iphonesimulator: not a device build',
    ]);
  });

  it('refuses test-only code, a forbidden string and StoreKit test files in production', () => {
    const facts: ArtifactFacts = {
      ...FACTS,
      bundleCounts: { TASKS_TEST_BUILD_ONLY: 2, 'placeholder.screen': 1 },
      testArtefacts: ['Tasks.app/Products.storekit'],
    };
    expect(storeGateProblems(facts, WANT)).toStrictEqual([
      'main.jsbundle contains the test-only sentinel TASKS_TEST_BUILD_ONLY 2 time(s)',
      'main.jsbundle contains the forbidden string placeholder.screen: unfinished work',
      'test artefact shipped: Tasks.app/Products.storekit',
    ]);
  });

  it('requires the sentinel in a preview build and the sample ad id with test ads', () => {
    const facts: ArtifactFacts = {
      ...withInfo({
        CFBundleIdentifier: 'com.acme.tasks.preview',
        GADApplicationIdentifier: SAMPLE_IOS_APP_ID,
      }),
      appConfig: { extra: { appVariant: 'preview', adsMode: 'test' } },
      bundleCounts: { TASKS_TEST_BUILD_ONLY: 1 },
    };
    const want = {
      ...WANT,
      variant: 'preview',
      adsMode: 'test',
      bundleId: 'com.acme.tasks.preview',
    } as const;
    expect(storeGateProblems(facts, want)).toStrictEqual([]);
    expect(storeGateProblems({ ...facts, bundleCounts: {} }, want)).toStrictEqual([
      'main.jsbundle lacks the test-only sentinel TASKS_TEST_BUILD_ONLY: bundled as production',
    ]);
  });

  it('names every placeholder value in production, and unfilled tokens in every variant', () => {
    const facts: ArtifactFacts = {
      ...FACTS,
      strings: [
        { where: 'app.config extra.supportEmail', value: 'support@example.com' },
        {
          where: 'Info.plist GADApplicationIdentifier',
          value: 'ca-app-pub-0000000000000000~0000000000',
        },
        { where: 'app.config extra.apiUrl', value: UNFILLED },
      ],
    };
    expect(storeGateProblems(facts, WANT)).toStrictEqual([
      '[ship-placeholder] app.config extra.supportEmail is a placeholder email address: support@example.com',
      '[ship-placeholder] Info.plist GADApplicationIdentifier is a template AdMob id (all-zero publisher): ca-app-pub-0000000000000000~0000000000',
      `[ship-placeholder] app.config extra.apiUrl is an unfilled template token: ${UNFILLED}`,
    ]);
  });

  it("accepts Google's sample ad id in a production build with ads off, never with live ads", () => {
    const sample = { where: 'app.config plugins.5.1.iosAppId', value: SAMPLE_IOS_APP_ID };
    const facts: ArtifactFacts = {
      ...withInfo({ GADApplicationIdentifier: SAMPLE_IOS_APP_ID }),
      appConfig: { extra: { appVariant: 'production', adsMode: 'off' } },
      strings: [sample],
    };
    expect(storeGateProblems(facts, { ...WANT, adsMode: 'off' })).toStrictEqual([]);
    expect(storeGateProblems({ ...facts, appConfig: FACTS.appConfig }, WANT)).toStrictEqual([
      `[ship-placeholder] app.config plugins.5.1.iosAppId is Google's sample AdMob id: ${SAMPLE_IOS_APP_ID}`,
    ]);
  });

  it('refuses a debug entitlement, an unsigned app and dev-client keys', () => {
    const facts: ArtifactFacts = {
      ...withInfo({ NSBonjourServices: ['_expo._tcp'] }),
      getTaskAllow: true,
    };
    expect(storeGateProblems(facts, WANT)).toStrictEqual([
      'the app is unsigned or its entitlements grant get-task-allow (a debug entitlement)',
      'NSBonjourServices holds _expo._tcp: a dev-client key in a Release archive',
    ]);
    expect(storeGateProblems({ ...FACTS, getTaskAllow: null }, WANT)).toHaveLength(1);
  });

  it('checks the encryption answer, the privacy manifest, ATS and the variant constants', () => {
    const facts: ArtifactFacts = {
      ...withInfo({
        ITSAppUsesNonExemptEncryption: undefined,
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      }),
      appConfig: { extra: { appVariant: 'preview', adsMode: 'live' } },
      hasPrivacyManifest: false,
      missingUsageStrings: ['ar.lproj/InfoPlist.strings lacks NSCameraUsageDescription'],
    };
    expect(storeGateProblems(facts, WANT)).toStrictEqual([
      'extra.appVariant is preview, not production',
      'PrivacyInfo.xcprivacy is missing',
      'NSAllowsArbitraryLoads is true',
      'ar.lproj/InfoPlist.strings lacks NSCameraUsageDescription',
      'ITSAppUsesNonExemptEncryption is not set',
    ]);
  });
});
