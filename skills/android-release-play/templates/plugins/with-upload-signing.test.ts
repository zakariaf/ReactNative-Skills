// plugins/with-upload-signing.test.ts
import withUploadSigning, { addUploadSigning } from './with-upload-signing.ts';

import type { ExpoConfig } from 'expo/config';
import type { ExportedConfig, Mod } from 'expo/config-plugins.js';

const APP_ID = 'com.acme.tasks';

/** The lines of expo-template-bare-minimum 57.0.30's android/app/build.gradle the plugin edits. */
const TEMPLATE_GRADLE = [
  'android {',
  '    signingConfigs {',
  '        debug {',
  "            storeFile file('debug.keystore')",
  "            storePassword 'android'",
  "            keyAlias 'androiddebugkey'",
  "            keyPassword 'android'",
  '        }',
  '    }',
  '    buildTypes {',
  '        debug {',
  '            signingConfig signingConfigs.debug',
  '        }',
  '        release {',
  '            // Caution! In production, you need to generate your own keystore file.',
  '            // see https://reactnative.dev/docs/signed-apk-android.',
  '            signingConfig signingConfigs.debug',
  '            minifyEnabled enableMinifyInReleaseBuilds',
  '        }',
  '    }',
  '}',
  '',
].join('\n');

/** A fresh config per test: Expo's with* helpers assign config.mods on the object they are given. */
function baseConfig(): ExpoConfig {
  return { name: 'Tasks', slug: 'tasks' };
}

/** Runs the queued app/build.gradle mod the way prebuild does, on contents handed in. */
async function runAppBuildGradle(config: ExportedConfig, contents: string): Promise<string> {
  const mods: Readonly<Record<string, Mod | undefined>> = { ...config.mods?.android };
  const mod = mods['appBuildGradle'];
  if (mod === undefined) {
    throw new Error('no android.appBuildGradle mod is queued');
  }
  const props = {
    ...baseConfig(),
    modResults: { contents, language: 'groovy' },
    modRawConfig: baseConfig(),
    modRequest: {
      projectRoot: '/project',
      platformProjectRoot: '/project/android',
      modName: 'appBuildGradle',
      platform: 'android',
      introspect: true,
    },
  } as unknown as Parameters<Mod>[0];
  const result = await mod(props);
  return (result.modResults as { contents: string }).contents;
}

describe('addUploadSigning', () => {
  it('adds the upload signing config that reads the app properties', () => {
    const gradle = addUploadSigning(TEMPLATE_GRADLE, APP_ID);

    expect(gradle).toContain(
      "        upload {\n            if (project.hasProperty('COM_ACME_TASKS_UPLOAD_STORE_FILE')) {",
    );
    expect(gradle).toContain("keyPassword project.property('COM_ACME_TASKS_UPLOAD_KEY_PASSWORD')");
  });

  it('signs release with the upload key only when its properties exist', () => {
    const gradle = addUploadSigning(TEMPLATE_GRADLE, APP_ID);

    expect(gradle).toContain(
      "signingConfig project.hasProperty('COM_ACME_TASKS_UPLOAD_STORE_FILE') ? signingConfigs.upload : signingConfigs.debug",
    );
    expect(gradle.match(/signingConfig signingConfigs\.debug\n/gu)).toHaveLength(1);
  });

  it('changes nothing the second time', () => {
    const once = addUploadSigning(TEMPLATE_GRADLE, APP_ID);

    expect(addUploadSigning(once, APP_ID)).toBe(once);
  });

  it('throws when the template lost the lines it edits', () => {
    expect(() => addUploadSigning('android {\n}\n', APP_ID)).toThrow('no signingConfigs block');
    expect(() =>
      addUploadSigning(
        TEMPLATE_GRADLE.replace(
          '            signingConfig signingConfigs.debug\n            min',
          '            min',
        ),
        APP_ID,
      ),
    ).toThrow('the release build type has no');
  });

  it('keeps passwords and key paths out of the file', () => {
    const gradle = addUploadSigning(TEMPLATE_GRADLE, APP_ID);

    expect(gradle).not.toMatch(/\.jks|storePassword '(?!android')/u);
  });
});

describe('withUploadSigning', () => {
  it('edits app/build.gradle through the queued mod', async () => {
    const config = withUploadSigning(baseConfig(), { applicationId: APP_ID });

    await expect(runAppBuildGradle(config, TEMPLATE_GRADLE)).resolves.toContain(
      'signingConfigs.upload',
    );
  });

  it('refuses a missing or malformed application id', () => {
    expect(() => withUploadSigning(baseConfig(), undefined)).toThrow('pass the production package');
    expect(() => withUploadSigning(baseConfig(), { applicationId: 'tasks' })).toThrow(
      'is not an Android package',
    );
  });
});
