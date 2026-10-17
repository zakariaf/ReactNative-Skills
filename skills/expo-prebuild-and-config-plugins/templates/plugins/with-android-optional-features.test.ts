// plugins/with-android-optional-features.test.ts
import { runMod } from '@test/config-plugins/run-mod';

import withAndroidOptionalFeatures, {
  addOptionalFeatures,
  validateFeatures,
} from './with-android-optional-features.ts';

import type { ExpoConfig } from 'expo/config';
import type { AndroidConfig } from 'expo/config-plugins.js';

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

const CAMERA = 'android.hardware.camera';
const AUTOFOCUS = 'android.hardware.camera.autofocus';

/** A fresh config per test: Expo's with* helpers assign config.mods on the object they are given. */
function baseConfig(): ExpoConfig {
  return { name: 'Tasks', slug: 'tasks' };
}

/** The manifest prebuild hands to mods (the namespace value is a stand-in; the plugin never reads it). */
function manifestWith(
  features: { name: string; required: 'true' | 'false' }[] = [],
): AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'android-namespace' },
      'uses-permission': [{ $: { 'android:name': 'android.permission.CAMERA' } }],
      queries: [],
      ...(features.length === 0
        ? {}
        : {
            'uses-feature': features.map(({ name, required }) => ({
              $: { 'android:name': name, 'android:required': required },
            })),
          }),
    },
  };
}

function declared(manifest: AndroidManifest): string[] {
  return (manifest.manifest['uses-feature'] ?? []).map(
    (entry) => `${entry.$['android:name']}=${entry.$['android:required']}`,
  );
}

describe('withAndroidOptionalFeatures', () => {
  it('declares every feature as not required through the queued manifest mod', async () => {
    const config = withAndroidOptionalFeatures(baseConfig(), { features: [CAMERA, AUTOFOCUS] });

    const manifest = await runMod(config, {
      platform: 'android',
      mod: 'manifest',
      modResults: manifestWith(),
    });

    expect(declared(manifest)).toStrictEqual([`${CAMERA}=false`, `${AUTOFOCUS}=false`]);
    expect(manifest.manifest['uses-permission']).toStrictEqual(
      manifestWith().manifest['uses-permission'],
    );
  });

  it('queues nothing for iOS', async () => {
    const config = withAndroidOptionalFeatures(baseConfig(), { features: [CAMERA] });

    await expect(
      runMod(config, { platform: 'ios', mod: 'infoPlist', modResults: {} }),
    ).rejects.toThrow('no ios.infoPlist mod is queued');
  });

  it('replaces a required declaration of the same feature and keeps every other one', () => {
    const before = manifestWith([
      { name: CAMERA, required: 'true' },
      { name: 'android.hardware.bluetooth', required: 'true' },
    ]);

    expect(declared(addOptionalFeatures(before, [CAMERA]))).toStrictEqual([
      'android.hardware.bluetooth=true',
      `${CAMERA}=false`,
    ]);
  });

  it('is idempotent: a second prebuild run onto the same manifest adds nothing', () => {
    const once = addOptionalFeatures(manifestWith(), [CAMERA, AUTOFOCUS]);

    expect(addOptionalFeatures(once, [CAMERA, AUTOFOCUS])).toStrictEqual(once);
  });

  it('rejects missing options, an empty list and names that are not Android features', () => {
    expect(() => validateFeatures(undefined)).toThrow('list the features');
    expect(() => validateFeatures({ features: [] })).toThrow('list the features');
    expect(() => validateFeatures({ features: ['camera'] })).toThrow(
      'is not an Android feature name',
    );
    expect(() => validateFeatures({ features: ['android.permission.CAMERA'] })).toThrow(
      'is not an Android feature name',
    );
  });

  it('removes duplicate features and keeps their order', () => {
    expect(validateFeatures({ features: [AUTOFOCUS, CAMERA, AUTOFOCUS] })).toStrictEqual([
      AUTOFOCUS,
      CAMERA,
    ]);
  });

  it('throws when app.config.ts lists the plugin without options', () => {
    expect(() => withAndroidOptionalFeatures(baseConfig(), undefined)).toThrow('list the features');
  });
});
