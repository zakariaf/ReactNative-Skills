#!/usr/bin/env node
// check-store-aab.mjs: the store-artifact gate for Google Play. It reads the exact Android App Bundle
// that will be uploaded (an EAS build artifact or the local lane's bundleRelease output) and proves
// what Play users would receive: signed with the registered upload key (never the debug key), a
// versionCode above every Android upload tag, the production package and version, no test-only code,
// not debuggable, no cleartext traffic, the target SDK floor, 16 KB pages and 64-bit libraries, every
// permission listed with its reason (and its Play declaration where Play asks for one), the app's own
// AdMob id and no template placeholder. A ship gate: no SKIP and no NOT APPLICABLE; --rehearsal (a
// keyless dry run) skips only the signing rule. --stamp writes the bundle's sha256 after a PASS, which
// the upload step requires.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-store-aab.mjs . --aab build/release-android/app-release.aab --stamp build/release-android/aab-gate.json
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, resolveLayout, run, toPosix } from './check-lib.mjs';
import { AabError, elfLoadAlignments, isDebugSubject, manifestModel, nativeLibAlignment, parseProtoXml, readZip, signerOf } from './lib/aab.mjs';
import { androidUploadNumbers, appConfigText, contractPath, contractProblems, dependsOn, literalVersion, readContract, readPackages, readTags, testOnlyGate, testOnlySentinels } from './lib/release-facts.mjs';
import { bundleIdProblem, placeholderProblem, placeholdersIn } from './lib/ship-placeholders.mjs';

const PLAY_FACTS = JSON.parse(readFileSync(new URL('../assets/play-facts.json', import.meta.url), 'utf8'));

const MANIFEST = 'base/manifest/AndroidManifest.xml';
const BUNDLE = 'base/assets/index.android.bundle';
const APP_CONFIG = 'base/assets/app.config';
const ADMOB_APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const PAGE = PLAY_FACTS.pageSize;

const SPEC = {
  name: 'check-store-aab',
  summary: 'The Google Play store-artifact gate: checks the exact Android App Bundle before an upload (upload-key signature, versionCode against the tags, package, version, test-only code, debuggable, cleartext, target SDK, 16 KB pages, 64-bit libraries, permissions and Play declarations, AdMob id, placeholders).',
  usage: '[repo-root] --aab <app-release.aab> [options]',
  options: {
    aab: { type: 'string', value: 'file', help: 'The bundle to upload, relative to the repo root (or absolute): the EAS build artifact (downloaded) or android/app/build/outputs/bundle/release/app-release.aab' },
    version: { type: 'string', value: 'x.y.z', help: "Expected versionName (default: the literal version of the app config)" },
    'version-code': { type: 'string', value: 'n', help: 'Expected versionCode (the number the build reported)' },
    'app-dir': { type: 'string', value: 'dir', help: "The app folder relative to the repo root (default '.'; when multi-package, e.g. apps/mobile: tags then start with mobile/)" },
    contract: { type: 'string', value: 'file', help: 'The release contract, repo-relative (default: rn-skills.config.json androidReleaseContract, else <app-dir>/contracts/android-release.json)' },
    'tags-list': { type: 'string', value: 'file', help: 'A file with one tag per line instead of git tag --list' },
    sentinel: { type: 'string', multiple: true, value: 'text', help: 'A string only test-only code contains (default: rn-skills.config.json testOnlySentinels plus every exported *SENTINEL* string under src/)' },
    stamp: { type: 'string', value: 'file', help: 'After a PASS (never with --rehearsal), write { result, sha256, versionCode, applicationId } here, relative to the repo root (or absolute); the upload step refuses a bundle without it. When multi-package: <app-dir>/build/release-android/aab-gate.json, where the CLI reads it' },
    rehearsal: { type: 'boolean', help: 'Keyless dry run: prints REHEARSAL: not a release gate and skips only the signing rule; never release evidence, never a stamp' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  signing                signed (META-INF/*.RSA|EC|DSA), never by the Android debug key, and the signer certificate\'s',
    '                         SHA-256 equals the contract uploadCertificateSha256 (Play App Signing\'s registered upload key)',
    `  version-code           an integer from 1 to ${PLAY_FACTS.versionCodeMax}, equal to --version-code when given, above every`,
    '                         Android upload tag (vX.Y.Z+android.<n>, and an older shared vX.Y.Z+<n>; Play refuses a number it has seen)',
    '  version-name           versionName equals --version (default: the app config\'s literal version)',
    '  package                the manifest package is the contract applicationId, a valid Android package, no .dev/.preview',
    '  constants-variant      base/assets/app.config exists, its android.package is the manifest package, extra.appVariant',
    '                         (when set) is production',
    '  test-code              base/assets/index.android.bundle exists and holds no test-only sentinel; a test-only gate with',
    '                         no known sentinel is a problem',
    '  debuggable             the application is not debuggable',
    '  cleartext              android:usesCleartextTraffic is not true',
    `  target-sdk             targetSdkVersion is at least ${PLAY_FACTS.targetSdkFloor} (Play's floor) and the contract minTargetSdk`,
    '  page-alignment         every arm64-v8a and x86_64 library has PT_LOAD segments aligned to 16 KB or more, and uncompressed',
    '                         libraries are 16 KB aligned in BundleConfig.pb (PAGE_ALIGNMENT_16K)',
    '  abi-64bit              every 32-bit library (armeabi-v7a, x86) has its 64-bit twin (arm64-v8a, x86_64)',
    '  permissions            every uses-permission is listed in the contract permissions with a reason (the app\'s own',
    '                         <package>.* permissions excepted)',
    '  permission-declaration a permission Play reviews against a Play Console declaration has playDeclaration in the contract',
    '  ad-app-id              with react-native-google-mobile-ads: com.google.android.gms.ads.APPLICATION_ID is present and well formed',
    '  ship-placeholder       no template value (com.example.*, Google sample or all-zero AdMob ids, example.com, __NAME__) in',
    '                         the package, the manifest meta-data or the embedded app config',
    'A ship gate: it never skips (only --rehearsal skips signing) and is never NOT APPLICABLE. Exit 2 when the bundle, the',
    'contract or the tags cannot be read, or the stamp cannot be written. Relative --aab, --stamp, --contract and --tags-list',
    'paths are read from the repo root. rn-skills.config.json keys: androidReleaseContract, testOnlySentinels.',
  ].join('\n'),
};

/** A path option as given: absolute, or relative to the repo root (never to the folder the gate was started from). */
function fromRoot(root, given) {
  return isAbsolute(given) ? given : resolve(root, given);
}

/** How a path is printed: repo-relative inside the repo, absolute outside it. */
function shown(root, abs) {
  const inside = toPosix(relative(root, abs));
  return inside === '' || inside.startsWith('../') || isAbsolute(inside) ? toPosix(abs) : inside;
}

function readInputs(options, root) {
  if (!options.aab) fail('nothing to check: --aab is required', 'Pass the bundle that will be uploaded (eas build:list shows the artifact; the local lane prints its path).');
  const aab = fromRoot(root, options.aab);
  if (!existsSync(aab) || !statSync(aab).isFile()) fail(`nothing to check: ${options.aab} is not a file`, 'Build or download the bundle first (references/release-pipeline.md).');
  let zip;
  try {
    zip = readZip(aab);
  } catch (error) {
    fail(`${options.aab} cannot be read as a bundle (${error.message})`, 'Pass the .aab file itself (bundleRelease or the EAS artifact), not an APK or a folder.');
  }
  const manifestBytes = zip.read(MANIFEST);
  if (manifestBytes === null) fail(`${options.aab} has no ${MANIFEST}: not an Android App Bundle`, 'Pass the .aab from bundle/release (buildType app-bundle on EAS), not an APK.');
  let manifest;
  try {
    manifest = parseProtoXml(manifestBytes);
  } catch (error) {
    fail(`${MANIFEST} cannot be decoded (${error instanceof AabError ? error.message : String(error)})`, 'Rebuild the bundle with bundleRelease.');
  }
  const layout = resolveLayout(root);
  const appDir = options['app-dir'] ?? '.';
  const contractRel = contractPath(root, layout, options.contract, appDir);
  const contract = readContract(root, contractRel);
  if (contract === null) fail(`${contractRel} does not exist`, 'Copy templates/contracts/android-release.json and fill it in (references/play-policy-and-artifact.md); the gate compares the bundle with it.');
  const shape = contractProblems(contract.data, PLAY_FACTS);
  if (shape.length > 0) fail(`${contractRel} ${shape[0].path} ${shape[0].message}`, `${shape[0].fix} Then run check-play-release-setup.mjs.`);
  const config = appConfigText(root, appDir);
  const version = options.version ?? (config ? literalVersion(config.masked) : null);
  if (!version) fail('no expected version: the app config has no literal version and --version is missing', 'Pass --version <x.y.z> (the version of this release).');
  const prefix = appDir === '.' ? null : posix.basename(toPosix(appDir));
  const where = shown(root, aab);
  const tagsList = options['tags-list'] ? fromRoot(root, options['tags-list']) : undefined;
  return { aab, zip, model: manifestModel(manifest), contract: contract.data, contractRel, layout, appDir, version, tags: readTags(root, tagsList), prefix, where, packages: readPackages(root, appDir) };
}

function checkSigning(ctx) {
  const { zip, where, options, report, contract, contractRel } = ctx;
  if (options.rehearsal) {
    report.skip({ file: where, rule: 'signing', message: 'keyless rehearsal (--rehearsal): the signature is not checked, so this run is not a release gate' });
    return;
  }
  let signed;
  try {
    signed = signerOf(zip);
  } catch (error) {
    if (!(error instanceof AabError)) throw error;
    report.problem({ file: where, rule: 'signing', message: `the signature block cannot be read (${error.message}): a truncated or corrupted bundle`, fix: 'Download the artifact again (or rebuild it) and rerun the gate; never upload a bundle whose signature the gate could not read.' });
    return;
  }
  const { isSigned, certificates } = signed;
  if (!isSigned || certificates.length === 0) {
    report.problem({ file: where, rule: 'signing', message: 'the bundle is not signed', fix: 'EAS lane: build with the production profile (EAS-managed credentials); local lane: the upload-signing plugin and the upload key properties in ~/.gradle/gradle.properties. Play refuses an unsigned bundle.' });
    return;
  }
  const signer = certificates[0];
  if (isDebugSubject(signer.subject)) {
    report.problem({ file: where, rule: 'signing', message: `the bundle is signed with the Android debug key (${signer.subject.replaceAll('\n', ', ')})`, fix: 'The release build fell back to the debug keystore: the upload key properties are missing on this machine (local lane) or the profile has no credentials (EAS). Play refuses debug-signed bundles.' });
    return;
  }
  const want = contract.uploadCertificateSha256;
  if (want === null) report.problem({ file: contractRel, rule: 'signing', message: `uploadCertificateSha256 is null; this bundle is signed by SHA-256 ${signer.sha256}`, fix: 'Confirm that this is the upload key you keep (eas credentials -p android, or Play Console App integrity after the first upload), then write the fingerprint into the contract. The gate then refuses any other key.' });
  else if (signer.sha256 !== want) report.problem({ file: where, rule: 'signing', message: `signed by SHA-256 ${signer.sha256}, but the registered upload key is ${want}`, fix: 'Play refuses a bundle signed by another key. Build with the registered upload key; if that key is lost, the developer requests an upload key reset in Play Console (App integrity) before anything else.' });
}

function checkVersions(ctx) {
  const { model, where, options, report, tags, prefix, version } = ctx;
  const file = `${where}!${MANIFEST}`;
  const code = Number(model.versionCode);
  if (!Number.isInteger(code) || code < 1 || code > PLAY_FACTS.versionCodeMax) report.problem({ file, rule: 'version-code', message: `versionCode is ${model.versionCode ?? 'missing'}, not an integer from 1 to ${PLAY_FACTS.versionCodeMax}`, fix: 'EAS lane: autoIncrement with remote versions; local lane: the ANDROID_VERSION_CODE of app.config.ts. Play allows nothing above 2100000000.' });
  if (options['version-code'] !== undefined && String(model.versionCode) !== options['version-code']) report.problem({ file, rule: 'version-code', message: `versionCode is ${model.versionCode ?? 'missing'}, expected ${options['version-code']}`, fix: 'The bundle is not the build you meant: download the artifact of that build, or prebuild with --clean after the build-number commit.' });
  for (const { tag } of androidUploadNumbers(tags, prefix).filter((item) => item.number >= code)) {
    report.problem({ file, rule: 'version-code', message: `versionCode ${code} is not above the upload tag ${tag}: Play refuses a versionCode it has seen`, fix: 'Build again with the next number (EAS remote versioning increments it; the local lane bumps ANDROID_VERSION_CODE above every tag). Never lower a number or reuse one.' });
  }
  if (model.versionName !== version) report.problem({ file, rule: 'version-name', message: `versionName is ${model.versionName ?? 'missing'}, expected ${version}`, fix: 'The version lives in app.config.ts version; prebuild again (EAS builds from the commit) after changing it.' });
}

function checkPackage(ctx) {
  const { model, where, report, contract, contractRel } = ctx;
  const file = `${where}!${MANIFEST}`;
  const id = model.package ?? '';
  const placeholder = placeholdersIn(id)[0];
  if (placeholder) report.problem(placeholderProblem({ entry: placeholder, value: id, where: 'the manifest package', file }));
  else {
    const problem = bundleIdProblem(id, { platform: 'android' });
    if (problem !== null) report.problem({ file, rule: 'package', message: `package ${problem}`, fix: 'Set android.package in app.config.ts.' });
  }
  if (/\.(dev|preview)$/.test(id)) report.problem({ file, rule: 'package', message: `package ${id} is a testing variant's id`, fix: 'Build the production variant (APP_VARIANT=production and EXPO_PUBLIC_APP_VARIANT=production for the whole build).' });
  else if (id !== contract.applicationId) report.problem({ file, rule: 'package', message: `package ${id || '(missing)'} is not the contract applicationId ${contract.applicationId}`, fix: `Play knows the app only by ${contract.applicationId} and it never changes; fix app.config.ts, or ${contractRel} if the contract is wrong.` });
}

function checkConstants(ctx) {
  const { zip, model, where, report } = ctx;
  const file = `${where}!${APP_CONFIG}`;
  const bytes = zip.read(APP_CONFIG);
  let config = null;
  try {
    config = bytes === null ? null : JSON.parse(bytes.toString('utf8'));
  } catch {
    config = null;
  }
  if (config === null || typeof config !== 'object') {
    report.problem({ file, rule: 'constants-variant', message: `${APP_CONFIG} is missing or not JSON`, fix: "expo-constants' Gradle task embeds it; prebuild with --clean and build again." });
    return null;
  }
  const embedded = config.android?.package;
  if (embedded !== model.package) report.problem({ file, rule: 'constants-variant', message: `the embedded app config says android.package ${embedded ?? '(missing)'}, the manifest ${model.package}`, fix: 'APP_VARIANT changed between prebuild and the Gradle build: export it once for the whole run.' });
  const variant = config.extra?.appVariant;
  if (variant !== undefined && variant !== 'production') report.problem({ file, rule: 'constants-variant', message: `extra.appVariant is "${variant}", expected "production"`, fix: 'Build with APP_VARIANT=production and EXPO_PUBLIC_APP_VARIANT=production (variantEnv) for the whole run.' });
  return config;
}

function checkTestCode(ctx) {
  const { zip, where, root, layout, options, report } = ctx;
  const file = `${where}!${BUNDLE}`;
  const bundle = zip.read(BUNDLE);
  if (bundle === null) {
    report.problem({ file, rule: 'test-code', message: 'the bundle embeds no index.android.bundle', fix: 'Build the release (bundleRelease) or the EAS production profile; a debug build loads its JS from Metro.' });
    return;
  }
  const sentinels = testOnlySentinels(root, layout, options.sentinel);
  if (sentinels.length === 0) {
    const gate = testOnlyGate(root, layout);
    if (gate !== null) report.problem({ file: gate.rel, line: gate.line, rule: 'test-code', message: `${gate.rel} gates test-only code, but no test-only sentinel is known: the gate cannot prove that code stayed out`, fix: "Export one from the test-only entry (export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY'), list it in rn-skills.config.json testOnlySentinels, or pass --sentinel." });
    return;
  }
  const text = bundle.toString('latin1');
  for (const sentinel of sentinels) {
    const count = text.split(sentinel).length - 1;
    if (count > 0) report.problem({ file, rule: 'test-code', message: `the store bundle contains the test-only sentinel "${sentinel}" ${count} time(s): the debug menu and test hooks would ship`, fix: "Build with APP_VARIANT and EXPO_PUBLIC_APP_VARIANT=production exported for the whole run, Metro's cache keyed on them, and the literal process.env.EXPO_PUBLIC_APP_VARIANT comparison at the test-only require()." });
  }
}

function checkManifest(ctx) {
  const { model, where, report, contract } = ctx;
  const file = `${where}!${MANIFEST}`;
  if (model.debuggable) report.problem({ file, rule: 'debuggable', message: 'the application is debuggable', fix: 'Build the release variant (bundleRelease); never set android:debuggable. Play refuses debuggable bundles.' });
  if (model.usesCleartextTraffic) report.problem({ file, rule: 'cleartext', message: 'android:usesCleartextTraffic is true: the release would send plain HTTP', fix: "Remove usesCleartextTraffic (expo-build-properties android.usesCleartextTraffic) from the production config; the debug manifest's cleartext is for Metro only." });
  const floor = Math.max(PLAY_FACTS.targetSdkFloor, contract.minTargetSdk);
  if (!(model.targetSdk >= floor)) report.problem({ file, rule: 'target-sdk', message: `targetSdkVersion is ${model.targetSdk ?? 'missing'}, below ${floor}`, fix: `Google Play refuses new apps and updates below API ${PLAY_FACTS.targetSdkFloor}; remove a lower expo-build-properties android.targetSdkVersion (Expo SDK 57 targets 36).` });
}

function checkNative(ctx) {
  const { zip, where, report } = ctx;
  const libs = zip.names.filter((name) => /^[^/]+\/lib\/[^/]+\/[^/]+\.so$/.test(name));
  for (const name of libs) {
    const abi = name.split('/')[2];
    if (!PLAY_FACTS.pageSizeAbis.includes(abi)) continue;
    const alignments = elfLoadAlignments(zip.read(name));
    if (alignments === null) report.problem({ file: `${where}!${name}`, rule: 'page-alignment', message: 'is not an ELF shared library', fix: 'Remove the file or rebuild the library.' });
    else if (alignments.some((value) => value < PAGE)) report.problem({ file: `${where}!${name}`, rule: 'page-alignment', message: `LOAD segments aligned to ${Math.min(...alignments)} bytes, below 16 KB: the app crashes on 16 KB devices and Play refuses the update`, fix: 'Update the package that ships this library to a 16 KB build (NDK r28, or -Wl,-z,max-page-size=16384); never ship a 4 KB library.' });
  }
  const config = zip.read('BundleConfig.pb');
  if (config !== null && libs.length > 0) {
    const { uncompressed, alignment } = nativeLibAlignment(config);
    if (uncompressed && !['16K', '64K'].includes(alignment)) report.problem({ file: `${where}!BundleConfig.pb`, rule: 'page-alignment', message: `native libraries are stored uncompressed with page alignment ${alignment} (bundletool's default is 4 KB)`, fix: 'Build with AGP 8.5.1 or newer (Expo SDK 57 ships AGP 8.12), which writes PAGE_ALIGNMENT_16K; check with bundletool dump config.' });
  }
  const present = new Set(libs.map((name) => name.split('/').slice(2).join('/')));
  for (const [abi32, abi64] of Object.entries(PLAY_FACTS.abiPairs)) {
    for (const lib of [...present].filter((path) => path.startsWith(`${abi32}/`))) {
      const twin = lib.replace(`${abi32}/`, `${abi64}/`);
      if (!present.has(twin)) report.problem({ file: `${where}!base/lib/${lib}`, rule: 'abi-64bit', message: `has no 64-bit twin ${twin}`, fix: 'Google Play requires the 64-bit version of every native library; build all ABIs (reactNativeArchitectures) or drop the 32-bit one.' });
    }
  }
}

function checkPermissions(ctx) {
  const { model, where, report, contract, contractRel } = ctx;
  const file = `${where}!${MANIFEST}`;
  const own = `${model.package}.`;
  for (const name of model.permissions) {
    if (name.startsWith(own)) continue;
    const entry = contract.permissions[name];
    if (entry === undefined) {
      const blocked = PLAY_FACTS.releaseOnlyBlocked[name];
      const fix = blocked ? `Block it for release (android.blockedPermissions: ['${name}']): ${blocked}. If the app really uses it, list it in ${contractRel} with the reason.` : `Find who adds it (the merged manifest); block it with android.blockedPermissions, or list it in ${contractRel} permissions with the reason. A new permission changes the Data safety answers.`;
      report.problem({ file, rule: 'permissions', message: `uses-permission ${name} is not in the contract`, fix });
      continue;
    }
    const declaration = PLAY_FACTS.declarationPermissions[name];
    if (declaration && !(typeof entry.playDeclaration === 'string' && entry.playDeclaration.trim() !== '')) report.problem({ file: contractRel, rule: 'permission-declaration', message: `${name} needs a Play Console declaration (${declaration}) and the contract entry has no playDeclaration`, fix: 'Complete the declaration in Play Console (a person does this), then write what was declared into playDeclaration; an undeclared permission gets the release rejected.' });
  }
}

function checkAdsAndPlaceholders(ctx, config) {
  const { model, where, report, packages } = ctx;
  const file = `${where}!${MANIFEST}`;
  const appId = model.metaData.find((item) => item.name === PLAY_FACTS.admobAppIdMeta)?.value ?? null;
  if (dependsOn(packages, 'react-native-google-mobile-ads') && appId === null) report.problem({ file, rule: 'ad-app-id', message: `${PLAY_FACTS.admobAppIdMeta} is missing`, fix: "The Google Mobile Ads SDK stops the app at launch without it; set the plugin's androidAppId for production (admob-ads-and-consent)." });
  if (appId !== null && placeholdersIn(appId).length === 0 && !ADMOB_APP_ID.test(appId)) report.problem({ file, rule: 'ad-app-id', message: `${PLAY_FACTS.admobAppIdMeta} is "${appId}", not an AdMob app id (ca-app-pub-<16 digits>~<10 digits>)`, fix: 'Copy the Android app id from AdMob (Apps, App settings).' });
  for (const item of model.metaData) {
    for (const entry of placeholdersIn(item.value ?? '')) report.problem(placeholderProblem({ entry, value: item.value, where: `meta-data ${item.name}`, file }));
  }
  if (config === null) return;
  const seen = new Set();
  const visit = (value, path) => {
    if (typeof value === 'string') {
      for (const entry of placeholdersIn(value)) {
        const key = `${entry.id}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        report.problem(placeholderProblem({ entry, value, where: `the embedded app config ${path}`, file: `${where}!${APP_CONFIG}` }));
      }
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) visit(item, path ? `${path}.${key}` : key);
  };
  visit(config, '');
}

/** The stamp is written before the summary (RESULT stays the last line), only when nothing failed. */
function writeStamp(ctx) {
  const { options, aab, model, contract, report, root } = ctx;
  if (!options.stamp || report.count !== 0 || options.rehearsal) return;
  const sha256 = createHash('sha256').update(readFileSync(aab)).digest('hex');
  const stamp = fromRoot(root, options.stamp);
  try {
    mkdirSync(dirname(stamp), { recursive: true });
    writeFileSync(stamp, `${JSON.stringify({ result: 'PASS', sha256, versionCode: Number(model.versionCode), applicationId: contract.applicationId, isRehearsal: false }, null, 2)}\n`);
  } catch (error) {
    fail(`the bundle passed, but the stamp ${options.stamp} cannot be written (${error.code ?? error.message})`, 'Pass a writable --stamp path inside the repo (relative paths start at the repo root; the local CLI reads <app folder>/build/release-android/aab-gate.json) and run the gate again. No stamp, no upload.');
  }
  console.log(`stamp written: ${shown(root, stamp)} (sha256 ${sha256})`);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const inputs = readInputs(options, root);
  if (options.rehearsal) console.log('REHEARSAL: not a release gate');
  const report = createReporter({ name: 'check-store-aab', json: options.json });
  const ctx = { ...inputs, root, options, report };
  checkSigning(ctx);
  checkVersions(ctx);
  checkPackage(ctx);
  const config = checkConstants(ctx);
  checkTestCode(ctx);
  checkManifest(ctx);
  checkNative(ctx);
  checkPermissions(ctx);
  checkAdsAndPlaceholders(ctx, config);
  writeStamp(ctx);
  return report.finish({ checked: 1, unit: `bundle (versionCode ${inputs.model.versionCode ?? '?'})` });
});
