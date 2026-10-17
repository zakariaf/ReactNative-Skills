// scripts/build/emu-build-config.test.ts
import { parseEmuBuildConfig } from './emu-build-config.ts';

describe('parseEmuBuildConfig', () => {
  it('fills every default when the contract is absent', () => {
    expect(parseEmuBuildConfig(undefined, '@acme/tasks-app')).toStrictEqual({
      avdPrefix: 'tasks-app',
      device: 'pixel_8',
      systemImage: null,
      postPrebuild: [],
      readyLog: null,
    });
  });

  it('keeps the keys it uses and ignores the keys only the checkers read', () => {
    const raw = {
      avdPrefix: 'tasks',
      device: 'medium_phone',
      systemImage: 'system-images;android-35;google_apis_playstore;arm64-v8a',
      postPrebuild: ['audit:android'],
      readyLog: { tag: 'ReactNativeJS', contains: 'tasks:ready' },
      appId: 'com.acme.tasks',
      permissions: ['android.permission.INTERNET'],
    };
    expect(parseEmuBuildConfig(raw, 'ignored')).toStrictEqual({
      avdPrefix: 'tasks',
      device: 'medium_phone',
      systemImage: 'system-images;android-35;google_apis_playstore;arm64-v8a',
      postPrebuild: ['audit:android'],
      readyLog: { tag: 'ReactNativeJS', contains: 'tasks:ready' },
    });
  });

  it('names every invalid key', () => {
    expect(() =>
      parseEmuBuildConfig({ avdPrefix: 'Tasks App', systemImage: 'android-36' }, 'tasks'),
    ).toThrow(/avdPrefix: must be kebab-case; systemImage: must be system-images/);
  });
});
