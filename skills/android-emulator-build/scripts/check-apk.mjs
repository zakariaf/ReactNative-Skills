#!/usr/bin/env node
// check-apk.mjs: checks a built Release APK (the file build:android:emu kept, one an EAS --local
// build wrote, or an unzipped / decoded APK folder) against the variant it claims to be: a Hermes
// bundle is embedded, test-only code is present (development, preview) or absent (production), the
// manifest is not debuggable and carries the variant's package, the pinned SDK levels and only the
// permissions the app declared, expo-constants' app.config agrees, the native libraries suit the
// emulator and 16 KB pages, no placeholder ships, and the APK is signed. "BUILD SUCCESSFUL" says none
// of this.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-apk.mjs . --apk build/android-emu/app-preview.apk --variant preview
import { join, posix, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, readProjectConfig, requireDir, resolveLayout, run, toPosix, UsageError } from './check-lib.mjs';
import { ApkError, manifestModel, parseManifest, readApk } from './lib/apk-reader.mjs';
import { checkAds, checkBundle, checkConstants, checkManifest, checkNative, checkPermissions, checkPlaceholders, checkSignature } from './lib/apk-rules.mjs';
import { PINNED, readEmuContract, readJsonFile, readRnCatalog, readToolchainPin } from './lib/emu-contract.mjs';

const VARIANTS = ['development', 'preview', 'production'];

const SPEC = {
  name: 'check-apk',
  summary: 'Checks a built Release APK against its variant: the embedded Hermes bundle, test-only code present or absent, not debuggable, the package, SDK levels, merged permissions, expo-constants app.config, native ABIs and 16 KB alignment, placeholders and the signing block.',
  usage: '[repo-root] --apk <file.apk|folder> --variant development|preview|production [options]',
  options: {
    apk: { type: 'string', value: 'path', help: 'The APK, relative to the repo root (build:android:emu keeps build/android-emu/app-<variant>.apk), or an unzipped / decoded APK folder' },
    variant: { type: 'string', value: 'name', help: 'APP_VARIANT the build was made with: development, preview or production' },
    abi: { type: 'string', value: 'abi', help: 'The ABI the APK must hold native libraries for (default: the contract abi, else arm64-v8a or x86_64)' },
    'target-sdk': { type: 'string', value: 'n', help: "Expected targetSdkVersion (default: the contract targetSdk, else React Native's catalog targetSdk in node_modules/react-native/gradle/libs.versions.toml, else ANDROID_API in scripts/android/toolchain.ts, else 36)" },
    version: { type: 'string', value: 'x.y.z', help: 'Expected versionName (the app config version)' },
    'version-code': { type: 'string', value: 'n', help: 'Expected versionCode' },
    'app-dir': { type: 'string', value: 'dir', help: "The app package folder (its package.json) relative to the repo root (default '.'; when multi-package, e.g. apps/mobile). Its dependencies and the root's both count" },
    sentinel: { type: 'string', multiple: true, value: 'text', help: 'A string only test-only code contains (default: every exported *SENTINEL* constant under src/, plus rn-skills.config.json testOnlySentinels)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  embedded-bundle    assets/index.android.bundle exists (Release embeds it) and is Hermes bytecode',
    '  test-code          every test-only sentinel is in a development or preview bundle and none is in a production bundle;',
    '                     a test-only gate without a sentinel is a problem; SKIP while the app has no gate',
    '                     (debug-menu-and-test-hooks creates src/test-only.ts)',
    '  debuggable         <application android:debuggable> is not true',
    "  application-id     the manifest package is a valid Android package and the variant's own: <appId>.dev, <appId>.preview, <appId>",
    '  sdk-levels         targetSdkVersion equals the expected target (--target-sdk, the contract, React Native\'s catalog,',
    '                     ANDROID_API, else 36), minSdkVersion is at least 24 and equals the contract minSdk',
    '  constants-variant  assets/app.config (expo-constants) exists, its android.package equals the manifest package and its',
    '                     extra.appVariant (when set) equals --variant',
    '  abi                lib/<abi>/ holds native libraries for --abi / the contract abi (else arm64-v8a or x86_64)',
    '  page-alignment     every arm64-v8a and x86_64 library has 16 KB aligned LOAD segments and, stored uncompressed in an',
    '                     APK file, starts on a 16 KB boundary',
    '  permissions        every uses-permission of the merged manifest is in the contract permissions (not checked without a list);',
    '                     ${applicationId}.NAME entries resolve against the manifest package, and an app-own signature permission',
    '                     (<package>.NAME declared by the APK, e.g. androidx.core DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION) passes',
    '  cleartext          production: <application android:usesCleartextTraffic> is not true',
    '  ad-app-id          with react-native-google-mobile-ads: the com.google.android.gms.ads.APPLICATION_ID meta-data is well formed',
    '  ship-placeholder   production: no placeholder value (com.example.*, Google sample AdMob ids, example.com links) in the',
    '                     manifest or app.config; every variant: no unfilled __PLACEHOLDER__',
    '  manifest-keys      every contract application attribute has its value',
    '  signature          an APK file carries an APK Signing Block (v2 or newer)',
    '  version, version-code  match --version / --version-code when given',
    'Example: node check-apk.mjs . --apk build/android-emu/app-production.apk --variant production',
  ].join('\n'),
};

function readInputs(root, options) {
  if (!options.apk) fail('nothing to check: --apk is required', 'Pass the APK build:android:emu kept (build/android-emu/app-<variant>.apk).');
  if (!VARIANTS.includes(options.variant)) fail(`--variant must be one of ${VARIANTS.join('|')}, got "${options.variant ?? ''}"`, 'Pass the APP_VARIANT the build was made with.');
  if (options.abi !== undefined && !['arm64-v8a', 'x86_64', 'armeabi-v7a', 'x86'].includes(options.abi)) fail(`--abi ${options.abi} is not an Android ABI`, 'Pass arm64-v8a or x86_64.');
  const path = resolve(root, options.apk);
  let apk;
  try {
    apk = readApk(path);
  } catch (error) {
    if (error instanceof ApkError) fail(`nothing to check: ${options.apk}: ${error.message}`, 'Pass the .apk file Gradle or EAS wrote, or an unzipped APK folder (an .aab is not an APK: android-release-play checks bundles).');
    throw error;
  }
  const manifest = apk.read('AndroidManifest.xml');
  if (manifest === null) fail(`nothing to check: ${options.apk} has no AndroidManifest.xml`, 'Pass a complete APK.');
  let model;
  try {
    model = manifestModel(parseManifest(manifest));
  } catch (error) {
    if (error instanceof ApkError || error instanceof RangeError) fail(`${options.apk}/AndroidManifest.xml cannot be read (${error.message})`, 'Pass the APK Gradle wrote; a truncated or hand-edited manifest is not a build output.');
    throw error;
  }
  const shown = toPosix(relative(root, path));
  return { apk, model, where: shown.startsWith('..') ? toPosix(path) : shown };
}

function readAppConfig(apk) {
  const data = apk.read('assets/app.config');
  if (data === null) return null;
  try {
    return JSON.parse(data.toString('utf8'));
  } catch {
    return undefined;
  }
}

function contractData(root, layout) {
  const contract = readEmuContract(root, layout);
  if (contract.problems.length > 0) fail(`${contract.rel} is not valid (${contract.problems[0].message})`, 'Run check-emu-setup.mjs, which names every invalid key, and fix the contract.');
  return contract.data;
}

/**
 * The expected targetSdk: --target-sdk, the contract, React Native's catalog targetSdk (it can stay
 * behind compileSdk, as SDK 58 is expected to do: compileSdk 37, targetSdk 36), ANDROID_API, else 36.
 */
function targetSdkOf(options, contract, root, layout, appDir) {
  if (options['target-sdk'] !== undefined) {
    const value = Number(options['target-sdk']);
    if (!Number.isInteger(value) || value < PINNED.minSdk) fail(`--target-sdk ${options['target-sdk']} is not an API level`, 'Pass an integer such as 36.');
    return value;
  }
  const catalog = Number(readRnCatalog(root, appDir)?.targetSdk);
  return contract.targetSdk ?? (Number.isInteger(catalog) ? catalog : null) ?? readToolchainPin(root, layout).api ?? PINNED.api;
}

function readPackageJson(root, rel) {
  const pkg = readJsonFile(root, rel);
  if (pkg !== null && (typeof pkg !== 'object' || Array.isArray(pkg))) throw new UsageError(`${rel} is not a JSON object`, `Fix ${rel}.`);
  return pkg;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const { apk, model, where } = readInputs(root, options);
  const layout = resolveLayout(root);
  const contract = contractData(root, layout);
  const appDir = posix.normalize(options['app-dir'] ?? '.');
  requireDir(join(root, appDir), 'app folder (--app-dir)');
  const pkgs = [...new Set([appDir, '.'])].map((dir) => readPackageJson(root, posix.join(dir, 'package.json'))).filter((pkg) => pkg !== null);
  const report = createReporter({ name: 'check-apk', json: options.json });
  const ctx = { root, apk, where, model, appConfig: readAppConfig(apk), options, contract, pkgs, layout, report, projectConfig: readProjectConfig(root), targetSdk: targetSdkOf(options, contract, root, layout, appDir) };
  checkBundle(ctx);
  checkManifest(ctx);
  checkConstants(ctx);
  checkNative(ctx);
  checkPermissions(ctx);
  checkAds(ctx);
  checkPlaceholders(ctx);
  checkSignature(ctx);
  return report.finish({ checked: 1, unit: `APK (${options.variant})` });
});
