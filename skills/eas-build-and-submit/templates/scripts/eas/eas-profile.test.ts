// scripts/eas/eas-profile.test.ts
import { resolveBuildProfile, storeProfileProblems, submitIdsOf } from './eas-profile.ts';

import type { EasJson } from './eas-profile.ts';

const PRODUCTION_ENV = { APP_VARIANT: 'production', EXPO_PUBLIC_APP_VARIANT: 'production' };

const BUILD: NonNullable<EasJson['build']> = {
  base: { node: '26.4.0', env: { SHARED: 'yes' } },
  preview: {
    extends: 'base',
    distribution: 'internal',
    env: { APP_VARIANT: 'preview', EXPO_PUBLIC_APP_VARIANT: 'preview' },
  },
  'preview-simulator': { extends: 'preview', ios: { simulator: true } },
  production: {
    extends: 'base',
    autoIncrement: true,
    env: PRODUCTION_ENV,
    android: { buildType: 'app-bundle', env: { ANDROID_ONLY: '1' } },
  },
};

const EAS: EasJson = {
  cli: { version: '>= 24.10.0', appVersionSource: 'remote', requireCommit: true },
  build: BUILD,
  submit: {
    production: {
      ios: { ascAppId: '6740000000', bundleIdentifier: 'com.example.tasks' },
      android: { applicationId: 'com.example.tasks' },
    },
  },
};

describe('resolveBuildProfile', () => {
  it('merges the extends chain with env one level deep, like EAS CLI', () => {
    const profile = resolveBuildProfile(EAS, 'preview', 'ios');
    expect(profile.node).toBe('26.4.0');
    expect(profile.env).toStrictEqual({
      SHARED: 'yes',
      APP_VARIANT: 'preview',
      EXPO_PUBLIC_APP_VARIANT: 'preview',
    });
  });

  it('defaults the distribution to store', () => {
    expect(resolveBuildProfile(EAS, 'production', 'ios').distribution).toBe('store');
  });

  it('merges the platform block over the common keys', () => {
    const android = resolveBuildProfile(EAS, 'production', 'android');
    expect(android.buildType).toBe('app-bundle');
    expect(android.env).toStrictEqual({ SHARED: 'yes', ...PRODUCTION_ENV, ANDROID_ONLY: '1' });
    expect(resolveBuildProfile(EAS, 'preview-simulator', 'ios').simulator).toBe(true);
    expect(resolveBuildProfile(EAS, 'preview-simulator', 'android').simulator).toBeUndefined();
  });

  it('refuses a missing profile, a missing parent and a cycle', () => {
    expect(() => resolveBuildProfile(EAS, 'staging', 'ios')).toThrow('missing build profile');
    const orphan: EasJson = { build: { a: { extends: 'gone' } } };
    expect(() => resolveBuildProfile(orphan, 'a', 'ios')).toThrow('extends a missing');
    const cycle: EasJson = { build: { a: { extends: 'b' }, b: { extends: 'a' } } };
    expect(() => resolveBuildProfile(cycle, 'a', 'ios')).toThrow('cycle');
  });
});

describe('storeProfileProblems', () => {
  it('accepts the production profile on both platforms', () => {
    expect(storeProfileProblems(EAS, 'production', 'ios')).toStrictEqual([]);
    expect(storeProfileProblems(EAS, 'production', 'android')).toStrictEqual([]);
  });

  it('names every reason an internal profile may not reach a store', () => {
    const problems = storeProfileProblems({ build: BUILD }, 'preview-simulator', 'ios');
    expect(problems).toStrictEqual([
      'build.preview-simulator (ios) builds variant "preview", not production',
      'build.preview-simulator (ios) is not a store build (distribution store, no simulator)',
      'build.preview-simulator (ios) has no autoIncrement: true, so a build number could repeat',
      'cli.appVersionSource is not "remote"',
      'cli.requireCommit is not true',
    ]);
  });

  it('wants a node pin for the EAS install', () => {
    const bare: EasJson = {
      ...EAS,
      build: { production: { autoIncrement: true, env: PRODUCTION_ENV } },
    };
    expect(storeProfileProblems(bare, 'production', 'ios')).toStrictEqual([
      'build.production (ios) pins no node for the EAS install',
    ]);
  });
});

describe('submitIdsOf', () => {
  it('reads the pinned ids, null when a profile pins none', () => {
    expect(submitIdsOf(EAS, 'production')).toStrictEqual({
      ios: 'com.example.tasks',
      android: 'com.example.tasks',
    });
    expect(submitIdsOf(EAS, 'preview')).toStrictEqual({ ios: null, android: null });
  });
});
