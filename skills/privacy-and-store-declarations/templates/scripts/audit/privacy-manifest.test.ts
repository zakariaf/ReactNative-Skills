// scripts/audit/privacy-manifest.test.ts
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  appTrackingProblems,
  collectedLines,
  localPodManifestPaths,
  mergeReasons,
  missingReasons,
  podspecPrivacyFiles,
  privacyProblems,
} from './privacy-manifest.ts';

import type { PrivacyManifest } from './privacy-manifest.ts';

// Shaped like Google-Mobile-Ads-SDK 13.6.0: no NSPrivacyTracking key, tracking only on Device ID.
const ADS_POD: PrivacyManifest = {
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
      NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
    },
  ],
  NSPrivacyCollectedDataTypes: [
    {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: true,
    },
  ],
};
const APP: PrivacyManifest = {
  NSPrivacyTracking: false,
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
      NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
    },
  ],
};

describe('privacyProblems', () => {
  it('passes when the app declares every pod reason and only declared pods track', () => {
    const pods = [{ pod: 'Google-Mobile-Ads-SDK', path: 'ios/Pods/x', manifest: ADS_POD }];

    expect(privacyProblems(pods, APP, new Set(['Google-Mobile-Ads-SDK']))).toStrictEqual([]);
    expect(collectedLines(pods)).toStrictEqual([
      'Google-Mobile-Ads-SDK: DeviceID linked=true tracking=true',
    ]);
  });

  it('fails a missing reason, an undeclared tracking pod and app tracking', () => {
    const pods = [{ pod: 'SomeAnalytics', path: 'ios/Pods/y', manifest: ADS_POD }];
    const app = { NSPrivacyTracking: true, NSPrivacyTrackingDomains: ['ads.example.test'] };

    expect(privacyProblems(pods, app, new Set())).toStrictEqual([
      'the app manifest lacks NSPrivacyAccessedAPICategorySystemBootTime 35F9.1',
      'pod SomeAnalytics declares tracking but no tracking SDK in contracts/privacy.json brings it (ios/Pods/y)',
      'the app manifest must set NSPrivacyTracking: false',
      'the app manifest must list no NSPrivacyTrackingDomains',
    ]);
  });

  it('flags a pod once per pod, whichever key says it tracks, and not a pod that only collects', () => {
    const consentPod: PrivacyManifest = {
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCoarseLocation',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
        },
      ],
    };
    const pods = [
      { pod: 'SomeAnalytics', path: 'ios/Pods/a/slice-1', manifest: { NSPrivacyTracking: true } },
      { pod: 'SomeAnalytics', path: 'ios/Pods/a/slice-2', manifest: { NSPrivacyTracking: true } },
      { pod: 'SomeConsent', path: 'ios/Pods/c', manifest: consentPod },
    ];

    expect(privacyProblems(pods, APP, new Set())).toStrictEqual([
      'pod SomeAnalytics declares tracking but no tracking SDK in contracts/privacy.json brings it (ios/Pods/a/slice-1)',
    ]);
  });

  it('merges reasons over manifests', () => {
    const merged = mergeReasons([ADS_POD, APP]);

    expect(missingReasons(merged, merged)).toStrictEqual([]);
    expect(appTrackingProblems(APP)).toStrictEqual([]);
  });
});

describe('development pods', () => {
  let ios = '';

  beforeEach(() => {
    ios = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'pods-'))), 'ios');
    const write = (rel: string, text: string): void => {
      mkdirSync(path.dirname(path.join(ios, rel)), { recursive: true });
      writeFileSync(path.join(ios, rel), text);
    };
    write(
      'Podfile.lock',
      'PODS:\n  - ExpoFileSystem (57.0.7)\n\nEXTERNAL SOURCES:\n  ExpoFileSystem:\n    :path: "../node_modules/expo-file-system/ios"\n\n',
    );
    write(
      'Pods/Local Podspecs/ExpoFileSystem.podspec.json',
      JSON.stringify({ resource_bundles: { ExpoFileSystem_privacy: ['PrivacyInfo.xcprivacy'] } }),
    );
    write('../node_modules/expo-file-system/ios/PrivacyInfo.xcprivacy', '<plist/>');
  });

  afterEach(() => {
    rmSync(path.dirname(ios), { recursive: true, force: true });
  });

  it('finds the manifest a development pod bundles from its own folder', () => {
    expect(localPodManifestPaths(ios)).toStrictEqual([
      {
        pod: 'ExpoFileSystem',
        path: path.join(ios, '../node_modules/expo-file-system/ios', 'PrivacyInfo.xcprivacy'),
      },
    ]);
  });

  it('expands resource globs the way CocoaPods does, and names the pod when it cannot', () => {
    const podspec = { ios: { resources: ['*.{xcprivacy,bundle}'] } };
    const root = path.join(ios, '../node_modules/expo-file-system/ios');

    expect(podspecPrivacyFiles(podspec, 'ExpoFileSystem', root)).toStrictEqual([
      'PrivacyInfo.xcprivacy',
    ]);
    expect(() => podspecPrivacyFiles(podspec, 'Gone', path.join(ios, 'missing'))).toThrow(
      'pod Gone: cannot expand',
    );
  });
});
