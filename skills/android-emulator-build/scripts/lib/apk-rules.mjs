// apk-rules.mjs: the rules of check-apk (a helper, not an entry point). Each check takes the context
// check-apk builds: { root, apk, where, model, appConfig, options, contract, pkgs, layout, report,
// projectConfig, targetSdk } (apk: readApk(); model: manifestModel(); pkgs: the app package's and the
// root package.json, a dependency in either counts).
//
//   checkBundle(ctx)        embedded-bundle, test-code
//   checkManifest(ctx)      debuggable, application-id, sdk-levels, cleartext, manifest-keys, version, version-code
//   checkConstants(ctx)     constants-variant
//   checkNative(ctx)        abi, page-alignment
//   checkPermissions(ctx)   permissions
//   checkAds(ctx)           ad-app-id
//   checkPlaceholders(ctx)  ship-placeholder
//   checkSignature(ctx)     signature
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { lineOf, notYetCreated, walkRepo } from '../check-lib.mjs';
import { elfLoadAlignments, HERMES_MAGIC } from './apk-reader.mjs';
import { dependsOn, PINNED } from './emu-contract.mjs';
import { bundleIdProblem, placeholderProblem, placeholdersIn } from './ship-placeholders.mjs';

/** The suffix app-variants-and-environment's variantIdentity gives each variant's id. */
export const VARIANT_SUFFIX = Object.freeze({ development: '.dev', preview: '.preview', production: '' });

const BUNDLE = 'assets/index.android.bundle';
const APP_CONFIG = 'assets/app.config';
const MANIFEST = 'AndroidManifest.xml';
const PAGE = 16384;
const EMULATOR_ABIS = ['arm64-v8a', 'x86_64'];
const ADMOB_APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const ADMOB_KEY = 'com.google.android.gms.ads.APPLICATION_ID';
const URL_OR_HOST = /^[a-z][a-z0-9+.-]*:\/\/|^[\w-]+(\.[\w-]+)+(\/|$)/i;
const SOURCE = /\.[cm]?[jt]sx?$/;
const NOT_APP_CODE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)__tests__\/|\.d\.ts$/;
const SENTINEL_CONST = /\bexport\s+const\s+([A-Z0-9_]*SENTINEL[A-Z0-9_]*)\s*(?::\s*[\w.<>|[\] ]+)?=\s*(['"])([^'"\n]{6,})\2/g;
const GATE_LITERAL = /process\.env\.EXPO_PUBLIC_APP_VARIANT\s*[!=]==?\s*(['"])(?:development|preview|production)\1/;
const GATE_OWNER = 'debug-menu-and-test-hooks';
const REBUILD = 'Rebuild through npm run build:android:emu (a clean prebuild with the variant exported for the whole run).';

const isTrue = (value) => value === true || value === 'true';

function appSources(ctx) {
  return walkRepo(ctx.root, { include: [`${ctx.layout.srcDir}/**`] }).filter((rel) => SOURCE.test(rel) && !NOT_APP_CODE.test(rel));
}

function sentinelsOf(ctx, sources) {
  if (ctx.options.sentinel.length > 0) return [...new Set(ctx.options.sentinel)];
  const found = new Set();
  const configured = ctx.projectConfig.testOnlySentinels;
  if (Array.isArray(configured)) configured.filter((value) => typeof value === 'string' && value !== '').forEach((value) => found.add(value));
  for (const rel of sources) {
    for (const match of readFileSync(join(ctx.root, rel), 'utf8').matchAll(SENTINEL_CONST)) found.add(match[3]);
  }
  return [...found].sort();
}

function findGate(ctx, sources) {
  const named = sources.find((rel) => /(?:^|\/)test-only\.[cm]?[jt]sx?$/.test(rel));
  if (named) return { rel: named, line: 1 };
  for (const rel of sources) {
    const text = readFileSync(join(ctx.root, rel), 'utf8');
    const match = GATE_LITERAL.exec(text);
    if (match && /\brequire\s*\(/.test(text)) return { rel, line: lineOf(text, match.index) };
  }
  return null;
}

function checkTestCode(ctx, bundle) {
  const file = `${ctx.where}/${BUNDLE}`;
  const sources = appSources(ctx);
  const sentinels = sentinelsOf(ctx, sources);
  if (sentinels.length === 0) {
    const gate = findGate(ctx, sources);
    const gateFile = posix.join(ctx.layout.srcDir, 'test-only.ts');
    if (gate === null) return ctx.report.skip({ file: gateFile, rule: 'test-code', message: notYetCreated(ctx.root, { file: gateFile, owner: GATE_OWNER }) ?? `not yet created (${GATE_OWNER} creates it)` });
    return ctx.report.problem({ file: gate.rel, line: gate.line, rule: 'test-code', message: `${gate.rel} gates test-only code, but no test-only sentinel is known: the APK cannot prove whether that code shipped`, fix: "Export one from the test-only entry (export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY'), list it in rn-skills.config.json testOnlySentinels, or pass --sentinel <text>." });
  }
  const text = bundle.toString('latin1');
  for (const sentinel of sentinels) {
    const count = text.split(sentinel).length - 1;
    if (ctx.options.variant === 'production' && count > 0) ctx.report.problem({ file, rule: 'test-code', message: `the production APK contains the test-only sentinel "${sentinel}" ${count} time(s): the debug menu and test hooks shipped`, fix: "Key Metro's cacheVersion on the EXPO_PUBLIC_* values, gate test-only code with the literal process.env.EXPO_PUBLIC_APP_VARIANT === 'production' comparison at its require(), export the variant once for the whole run, then rebuild." });
    if (ctx.options.variant !== 'production' && count === 0) ctx.report.problem({ file, rule: 'test-code', message: `the ${ctx.options.variant} APK lacks the test-only sentinel "${sentinel}": it was bundled as production, or the entry is not reachable`, fix: `Export APP_VARIANT=${ctx.options.variant} and EXPO_PUBLIC_APP_VARIANT=${ctx.options.variant} for the whole run (variantEnv) and rebuild; a stale Metro cache or a lost variable causes this.` });
  }
  return undefined;
}

/** embedded-bundle and test-code. */
export function checkBundle(ctx) {
  const bundle = ctx.apk.read(BUNDLE);
  const file = `${ctx.where}/${BUNDLE}`;
  if (bundle === null) return ctx.report.problem({ file, rule: 'embedded-bundle', message: 'the APK embeds no JS bundle, so it loads its JS from Metro (a Debug build)', fix: 'Build :app:assembleRelease (gradleReleaseArgs): a Release build embeds the Hermes bundle users run.' });
  if (!bundle.subarray(0, 8).equals(HERMES_MAGIC)) ctx.report.problem({ file, rule: 'embedded-bundle', message: 'the embedded bundle is not Hermes bytecode', fix: 'Keep hermesEnabled=true (the Expo SDK 57 default; never set jsEngine to jsc) and rebuild: plain JS parses at every launch.' });
  return checkTestCode(ctx, bundle);
}

function expectedIdProblem(id, variant, appId) {
  const suffix = VARIANT_SUFFIX[variant];
  if (appId !== undefined) return id === `${appId}${suffix}` ? null : `is "${id}", expected "${appId}${suffix}" for a ${variant} build`;
  if (variant === 'production') return /\.(dev|preview)$/.test(id) ? `is "${id}", a testing variant's id, in a production build` : null;
  return id.endsWith(suffix) ? null : `is "${id}", but a ${variant} build's id ends in ${suffix} (it installs beside the store app)`;
}

function checkIdentity(ctx, file) {
  const id = ctx.model.package ?? '';
  const fix = 'The id comes from variantIdentity() in app.config.ts (app-variants-and-environment): <appId>.dev, <appId>.preview, <appId>; build with the variant exported for the whole run, from a clean prebuild.';
  const shape = bundleIdProblem(id, { platform: 'android' });
  if (shape !== null && !/ is (the template|an unfilled)/.test(shape)) return ctx.report.problem({ file, rule: 'application-id', message: `the package ${shape}`, fix });
  const problem = expectedIdProblem(id, ctx.options.variant, ctx.contract.appId);
  if (problem !== null) ctx.report.problem({ file, rule: 'application-id', message: `the package ${problem}`, fix });
  return undefined;
}

function checkLevels(ctx, file) {
  const { minSdk, targetSdk } = ctx.model;
  const levelFix = "The levels come from React Native's version catalog (or expo-build-properties android.minSdkVersion/targetSdkVersion); prebuild with --clean after changing them.";
  if (targetSdk !== ctx.targetSdk) ctx.report.problem({ file, rule: 'sdk-levels', message: `targetSdkVersion is ${targetSdk ?? 'missing'}, expected ${ctx.targetSdk}`, fix: `${levelFix} Google Play requires targetSdk 36 for new apps and updates since 2026-08-31.` });
  if (minSdk === null || minSdk < PINNED.minSdk) ctx.report.problem({ file, rule: 'sdk-levels', message: `minSdkVersion is ${minSdk ?? 'missing'}, below ${PINNED.minSdk} (the React Native 0.86 floor)`, fix: levelFix });
  else if (ctx.contract.minSdk !== undefined && minSdk !== ctx.contract.minSdk) ctx.report.problem({ file, rule: 'sdk-levels', message: `minSdkVersion is ${minSdk}, the contract says ${ctx.contract.minSdk}`, fix: levelFix });
}

/** debuggable, application-id, sdk-levels, cleartext, manifest-keys, version, version-code. */
export function checkManifest(ctx) {
  const file = `${ctx.where}/${MANIFEST}`;
  const app = ctx.model.application;
  if (isTrue(app.debuggable)) ctx.report.problem({ file, rule: 'debuggable', message: 'android:debuggable is true: anyone can attach a debugger and read the app\'s data', fix: 'Build the release build type (:app:assembleRelease); never set debuggable in a manifest or a config plugin.' });
  checkIdentity(ctx, file);
  checkLevels(ctx, file);
  if (ctx.options.variant === 'production' && isTrue(app.usesCleartextTraffic)) ctx.report.problem({ file, rule: 'cleartext', message: 'android:usesCleartextTraffic is true in a production build', fix: 'The app talks HTTPS through its ApiClient; remove the flag (the template sets it only in the debug manifest) or allow one domain with a network security config.' });
  for (const [key, want] of Object.entries(ctx.contract.application ?? {})) {
    if (String(app[key]) !== String(want)) ctx.report.problem({ file, rule: 'manifest-keys', message: `<application android:${key}> is ${JSON.stringify(app[key] ?? 'missing')}, the contract expects ${JSON.stringify(want)}`, fix: `Set it in app.config.ts (android.${key} or the config plugin that owns it) and prebuild with --clean.` });
  }
  if (ctx.options.version && ctx.model.versionName !== ctx.options.version) ctx.report.problem({ file, rule: 'version', message: `versionName is "${ctx.model.versionName}", expected ${ctx.options.version}`, fix: 'The version comes from the app config only; prebuild with --clean after changing it.' });
  if (ctx.options['version-code'] && String(ctx.model.versionCode) !== ctx.options['version-code']) ctx.report.problem({ file, rule: 'version-code', message: `versionCode is ${ctx.model.versionCode}, expected ${ctx.options['version-code']}`, fix: 'android.versionCode comes from the app config (or EAS remote versions) only; prebuild with --clean after changing it.' });
}

/** constants-variant: assets/app.config (expo-constants) agrees with the manifest and the variant. */
export function checkConstants(ctx) {
  const file = `${ctx.where}/${APP_CONFIG}`;
  const fix = `The createExpoConfig task did not see the build's environment, or the variant changed between prebuild and Gradle. ${REBUILD}`;
  if (ctx.appConfig === null) return ctx.report.problem({ file, rule: 'constants-variant', message: 'assets/app.config (written by expo-constants at build time) is missing', fix });
  if (ctx.appConfig === undefined) return ctx.report.problem({ file, rule: 'constants-variant', message: 'assets/app.config is not JSON', fix });
  const configId = ctx.appConfig.android?.package;
  if (typeof configId === 'string' && configId !== ctx.model.package) ctx.report.problem({ file, rule: 'constants-variant', message: `android.package is "${configId}" but the manifest says "${ctx.model.package}": the variant changed between prebuild and the Gradle build`, fix });
  const extraVariant = ctx.appConfig.extra?.appVariant;
  if (extraVariant !== undefined && extraVariant !== ctx.options.variant) ctx.report.problem({ file, rule: 'constants-variant', message: `extra.appVariant is "${extraVariant}", expected "${ctx.options.variant}"`, fix });
  return undefined;
}

/** abi and page-alignment. */
export function checkNative(ctx) {
  const libs = ctx.apk.names.filter((name) => /^lib\/[^/]+\/[^/]+\.so$/.test(name));
  const abis = [...new Set(libs.map((name) => name.split('/')[1]))].sort();
  const wanted = ctx.options.abi ?? ctx.contract.abi ?? null;
  const ok = wanted === null ? abis.some((abi) => EMULATOR_ABIS.includes(abi)) : abis.includes(wanted);
  if (!ok) ctx.report.problem({ file: `${ctx.where}/lib/`, rule: 'abi', message: `the APK holds native libraries for ${abis.length === 0 ? 'no ABI' : abis.join(', ')}, not ${wanted ?? 'arm64-v8a or x86_64'}: the emulator refuses it (INSTALL_FAILED_NO_MATCHING_ABIS)`, fix: 'Build with -PreactNativeArchitectures=<the emulator ABI> (hostAbi(): arm64-v8a on Apple silicon, x86_64 elsewhere).' });
  for (const name of libs.filter((lib) => /^lib\/(arm64-v8a|x86_64)\//.test(lib))) {
    const alignments = elfLoadAlignments(ctx.apk.read(name)) ?? [];
    const low = alignments.find((align) => align < PAGE);
    if (low !== undefined) ctx.report.problem({ file: `${ctx.where}/${name}`, rule: 'page-alignment', message: `a LOAD segment is aligned to ${low} bytes, not 16 KB: the library fails to load on 16 KB page devices`, fix: 'Update the library that ships it (Google Play requires 16 KB page support for apps that target Android 15 or newer); link native code with -Wl,-z,max-page-size=16384 (NDK r28 does by default).' });
    const entry = ctx.apk.entry(name);
    if (entry !== null && entry.method === 0 && entry.dataOffset % PAGE !== 0) ctx.report.problem({ file: `${ctx.where}/${name}`, rule: 'page-alignment', message: `stored uncompressed at byte ${entry.dataOffset} of the APK, not on a 16 KB boundary`, fix: 'Build with the Android Gradle Plugin from the template (8.5.1 or newer aligns stored libraries to 16 KB); never re-zip an APK by hand.' });
  }
}

/** The contract spelling of a permission named after the app's own package, whatever the variant. */
export const APP_ID_TOKEN = '${applicationId}';

/**
 * permissions: every merged uses-permission is in the contract's list. Two kinds of name follow the
 * variant's package (com.acme.tasks.preview.X in preview, com.acme.tasks.X in production): an app-own
 * signature permission the APK declares itself (androidx.core's DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION,
 * in every React Native app) passes without a list entry, and a contract entry "${applicationId}.X"
 * resolves against the manifest package, so one contract serves every variant.
 */
export function checkPermissions(ctx) {
  const listed = ctx.contract.permissions;
  if (listed === undefined) return ctx.report.note(`permissions (not checked, no contract list): ${ctx.model.permissions.join(', ') || 'none'}`);
  const pkg = ctx.model.package ?? '';
  const ownPrefix = pkg === '' ? null : `${pkg}.`;
  const allowed = new Set(listed.map((name) => (name.startsWith(`${APP_ID_TOKEN}.`) ? `${pkg}${name.slice(APP_ID_TOKEN.length)}` : name)));
  const own = new Set(ctx.model.declaredPermissions.filter((entry) => entry.signature && ownPrefix !== null && entry.name.startsWith(ownPrefix)).map((entry) => entry.name));
  for (const permission of ctx.model.permissions.filter((name) => !allowed.has(name) && !own.has(name))) {
    const appNamed = ownPrefix !== null && permission.startsWith(ownPrefix);
    const fix = appNamed
      ? `It is named after the app's package but the APK does not declare it as a signature permission (<permission android:protectionLevel="signature">), so it is not the app's own. When the app or a library requests it on purpose, list it as "${APP_ID_TOKEN}.${permission.slice(ownPrefix.length)}" in the contract (one entry for every variant); otherwise find the library that adds it in the Gradle manifest-merger report and remove it there.`
      : 'Remove it with android.blockedPermissions in app.config.ts (or the library\'s plugin option), or, when the app truly needs it, add it to the contract\'s permissions and declare it in the store forms (privacy-and-store-declarations).';
    ctx.report.problem({ file: `${ctx.where}/${MANIFEST}`, rule: 'permissions', message: `the merged manifest requests ${permission}, which the contract does not list (a library can add it at Gradle merge time)`, fix });
  }
  return undefined;
}

/** ad-app-id: with the ads SDK, the AdMob app id meta-data is present and well formed. */
export function checkAds(ctx) {
  const meta = ctx.model.metaData.find((entry) => entry.name === ADMOB_KEY);
  if (!dependsOn(ctx.pkgs, 'react-native-google-mobile-ads') && meta === undefined) return;
  const file = `${ctx.where}/${MANIFEST}`;
  const fix = "react-native-google-mobile-ads' config plugin writes it from androidAppId (admob-ads-and-consent selects the id per variant); prebuild with --clean.";
  if (meta === undefined || typeof meta.value !== 'string' || meta.value === '') ctx.report.problem({ file, rule: 'ad-app-id', message: `${ADMOB_KEY} is missing, and the Google Mobile Ads SDK stops the app at launch without it`, fix });
  else if (!ADMOB_APP_ID.test(meta.value)) ctx.report.problem({ file, rule: 'ad-app-id', message: `${ADMOB_KEY} "${meta.value}" is not an AdMob app id (ca-app-pub-<16 digits>~<10 digits>)`, fix });
}

function leaves(value, path, out) {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, `${path}.${index}`, out));
  else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, item]) => leaves(item, path === '' ? key : `${path}.${key}`, out));
  return out;
}

/** ship-placeholder: production APKs carry no placeholder; no APK carries an unfilled token. */
export function checkPlaceholders(ctx) {
  const production = ctx.options.variant === 'production';
  const manifestValues = [{ path: 'package', value: ctx.model.package ?? '' }, ...ctx.model.metaData.filter((entry) => typeof entry.value === 'string').map((entry) => ({ path: `meta-data ${entry.name}`, value: entry.value }))];
  const sources = [
    { file: `${ctx.where}/${MANIFEST}`, label: 'the manifest', values: manifestValues },
    { file: `${ctx.where}/${APP_CONFIG}`, label: 'app.config', values: leaves(ctx.appConfig ?? {}, '', []) },
  ];
  for (const source of sources) {
    for (const { path, value } of source.values) {
      const entries = placeholdersIn(value).filter((entry) => (production ? entry.id !== 'example-domain' || URL_OR_HOST.test(value.trim()) : entry.id === 'template-token'));
      for (const entry of entries) ctx.report.problem(placeholderProblem({ entry, value, where: `${source.label} ${path}`, file: source.file }));
    }
  }
}

/** signature: an APK file carries an APK Signing Block (v2+); without one adb install refuses it. */
export function checkSignature(ctx) {
  if (ctx.apk.signingBlock !== false) return;
  ctx.report.problem({ file: ctx.where, rule: 'signature', message: 'the APK has no APK Signing Block (v2 or newer), so the package installer refuses it (INSTALL_PARSE_FAILED_NO_CERTIFICATES)', fix: 'Install the APK Gradle wrote (the template signs Release with the debug keystore); never re-zip or edit an APK after the build.' });
}
