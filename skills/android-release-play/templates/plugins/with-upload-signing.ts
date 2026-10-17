// plugins/with-upload-signing.ts
// A local config plugin (local release lane): signs Android release builds with the app's upload key.
// React Native's template signs release builds with the debug keystore. This adds a signing config
// `upload` that reads the app's own Gradle properties (COM_ACME_TASKS_UPLOAD_*, which the
// developer's ~/.gradle/gradle.properties holds) and uses it for release builds when they exist.
// Without them (an emulator build, a keyless rehearsal, an EAS build that injects its own signing)
// the release stays on the debug key, and the store-AAB gate refuses such a bundle. Only Gradle ever
// reads the key and its passwords. app.config.ts lists it by path in every variant:
//   ['./plugins/with-upload-signing.ts', { applicationId: 'com.acme.tasks' }]
// It throws at prebuild when the template lost the lines it edits, so a React Native upgrade never
// drops the signing silently. Verified against expo-template-bare-minimum 57.0.30 (2026-10-14).
import { withAppBuildGradle } from 'expo/config-plugins.js';

import { uploadSigningProperties } from '../scripts/release-android/upload-key.ts';

import type { ConfigPlugin } from 'expo/config-plugins.js';

/** The plugin's options in app.config.ts: the production android.package. */
export type UploadSigningOptions = { readonly applicationId: string };

const SIGNING_BLOCK = /^(?<indent>[ \t]*)signingConfigs \{\n/mu;
const RELEASE_SIGNING =
  /(?<head>\n[ \t]*release \{\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*)signingConfig signingConfigs\.debug\n/u;

function uploadBlock(applicationId: string, indent: string): string {
  const names = uploadSigningProperties(applicationId);
  const inner = `${indent}    `;
  const property = (name: string): string => `project.property('${name}')`;
  return [
    `${inner}upload {`,
    `${inner}    if (project.hasProperty('${names.storeFile}')) {`,
    `${inner}        storeFile file(${property(names.storeFile)})`,
    `${inner}        storePassword ${property(names.storePassword)}`,
    `${inner}        keyAlias ${property(names.keyAlias)}`,
    `${inner}        keyPassword ${property(names.keyPassword)}`,
    `${inner}    }`,
    `${inner}}`,
    '',
  ].join('\n');
}

/** app/build.gradle with the upload signing config; unchanged when it is already there. */
export function addUploadSigning(gradle: string, applicationId: string): string {
  if (gradle.includes('signingConfigs.upload')) {
    return gradle;
  }
  const block = SIGNING_BLOCK.exec(gradle);
  if (block === null) {
    throw new Error(
      'withUploadSigning: app/build.gradle has no signingConfigs block (the React Native template changed): update the plugin and its test.',
    );
  }
  if (!RELEASE_SIGNING.test(gradle)) {
    throw new Error(
      'withUploadSigning: the release build type has no "signingConfig signingConfigs.debug" line (the React Native template changed): update the plugin and its test.',
    );
  }
  const { storeFile } = uploadSigningProperties(applicationId);
  const indent = block.groups?.['indent'] ?? '';
  return gradle
    .replace(SIGNING_BLOCK, (opening) => `${opening}${uploadBlock(applicationId, indent)}`)
    .replace(
      RELEASE_SIGNING,
      (_line, head: string) =>
        `${head}signingConfig project.hasProperty('${storeFile}') ? signingConfigs.upload : signingConfigs.debug\n`,
    );
}

function validate(options: UploadSigningOptions | undefined): string {
  if (options === undefined) {
    throw new Error(
      "withUploadSigning: pass the production package: ['./plugins/with-upload-signing.ts', { applicationId: 'com.acme.tasks' }].",
    );
  }
  uploadSigningProperties(options.applicationId);
  return options.applicationId;
}

const withUploadSigning: ConfigPlugin<UploadSigningOptions | undefined> = (config, options) => {
  const applicationId = validate(options);
  return withAppBuildGradle(config, (next) => ({
    ...next,
    modResults: {
      ...next.modResults,
      contents: addUploadSigning(next.modResults.contents, applicationId),
    },
  }));
};

/** @public Expo loads it from the path app.config.ts names, so it is the default export. */
export default withUploadSigning;
