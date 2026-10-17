#!/usr/bin/env node
// check-store-artifact.mjs: the store-artifact gate on an exported .ipa (or its unpacked
// Payload/<App>.app), from the local lane or EAS Build alike, run before --validate-app or eas
// submit, and again before the developer is told a build is ready. It proves what testers and users
// receive: the right identity, version, build number and Xcode; the variant in every place it
// enters the binary; no test-only code, StoreKit test files, debug entitlement, dev-client key or
// placeholder value; the usage strings in every language; the privacy manifest; no ATS exception.
// A ship gate: it never skips. --rehearsal is the keyless dry run only (an archive built with
// CODE_SIGNING_ALLOWED=NO): it prints REHEARSAL first, reports the signing rule as SKIP, keeps every
// other rule strict, and its result is never release evidence.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-store-artifact.mjs . --ipa build/ios-release/export/Tasks.ipa --variant production --version 1.4.0 --build 14
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';

import { createReporter, fail, makeTempDir, parseArgs, removeTempDir, requireDir, resolveLayout, run, toPosix } from './check-lib.mjs';
import { checkAds, checkBundle, checkConstants, checkIdentity, checkMarkers, checkPlaceholders, checkPlistKeys, checkRehearsalAdIds, checkSignature, checkUsageStrings } from './lib/artifact-rules.mjs';
import { readPlist } from './lib/plist.mjs';
import { contractDefaults, dependsOn, readJsonFile, readReleaseContract, readXcodePin } from './lib/release-contract.mjs';

const ADS_MODES = { preview: ['test', 'off'], production: ['live', 'off'] };

const SPEC = {
  name: 'check-store-artifact',
  summary: 'The store-artifact gate: checks an exported .ipa (or Payload/<App>.app) for its identity, variant, test-only code, test artefacts, signature, ad app id, placeholders, usage strings, privacy manifest, ATS, dev-client keys and Xcode.',
  usage: '[repo-root] (--ipa <file.ipa> | --app <Payload/App.app>) --variant preview|production --version X.Y.Z --build N [options]',
  options: {
    ipa: { type: 'string', value: 'file', help: 'The exported .ipa (unzipped into a temporary folder)' },
    app: { type: 'string', value: 'dir', help: 'An unpacked Payload/<App>.app folder (or the .app inside an unsigned rehearsal archive)' },
    variant: { type: 'string', value: 'name', help: 'APP_VARIANT of the build: preview (internal TestFlight) or production (the store)' },
    ads: { type: 'string', value: 'mode', help: 'ADS_MODE of the build when the app has the ads SDK: preview test|off, production live|off (default: extra.adsMode, else test / the contract productionAdsMode, live by default)' },
    version: { type: 'string', value: 'x.y.z', help: 'Expected CFBundleShortVersionString (the app config version)' },
    build: { type: 'string', value: 'n', help: 'Expected CFBundleVersion (the new build number)' },
    'app-id': { type: 'string', value: 'id', help: 'The production bundle id (default: contracts/ios-release.json appId)' },
    xcode: { type: 'string', value: 'version', help: 'Xcode that must have built it (default: XCODE_VERSION in scripts/ios/toolchain.ts)' },
    sentinel: { type: 'string', multiple: true, value: 'text', help: 'A string only test-only code contains (default: exported *SENTINEL* constants under src/ (and <appDir>/src when multi-package) and rn-skills.config.json testOnlySentinels)' },
    entitlements: { type: 'string', value: 'plist', help: 'Entitlements plist to use instead of running codesign -d (self-tests only)' },
    rehearsal: { type: 'boolean', help: "Keyless rehearsal (archive built with CODE_SIGNING_ALLOWED=NO): prints 'REHEARSAL: not a release gate' first and reports only the signing rule as SKIP; never passed by release:ios, never release evidence" },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'repo-root (default .): the repo the build came from (contract, Xcode pin, sentinels, package.json).',
    'Rules (production builds run all; preview builds all but encryption-flag and test-artefacts):',
    '  identity          CFBundleShortVersionString, CFBundleVersion, DTXcode of the pinned Xcode, DTPlatformName iphoneos',
    '  bundle-id         CFBundleIdentifier is a real iOS id (never com.example.*) and the variant\'s own: <appId>, <appId>.preview',
    '  constants         EXConstants.bundle/app.config exists and its ios.bundleIdentifier, extra.appVariant and extra.adsMode',
    '                    (when set) agree with Info.plist and the release',
    '  get-task-allow    the app is signed and its entitlements do not grant get-task-allow; with --rehearsal an app',
    '                    without a signature is a SKIP line (the only relaxation)',
    '  ad-app-id         with the ads SDK: GADApplicationIdentifier present; Google\'s sample for test/off builds, a real',
    '                    AdMob app id for live builds',
    '  ship-placeholder  production: no placeholder value (template bundle id, sample or template AdMob ids, example.com',
    '                    links) in Info.plist or EXConstants; every build: no unfilled __TOKEN__. A keyless production/off',
    '                    rehearsal of an app whose store build runs live ads (contract productionAdsMode, default live)',
    '                    also reads the ad ids file (contract adIdsFile, default src/config/admob-ids.ts)',
    '  usage-strings     every contract usageStrings key, NSUserTrackingUsageDescription when the app can ask for tracking,',
    '                    and every NS*UsageDescription the app carries, in Info.plist and in every app language',
    '  test-code         main.jsbundle exists; test-only sentinels absent in production, present in preview',
    '  forbidden-string  no contract forbiddenBundleStrings in main.jsbundle',
    '  unfinished-marker no contract unfinishedMarkers file in the repo',
    '  privacy-manifest  PrivacyInfo.xcprivacy is in the bundle',
    '  ats               NSAppTransportSecurity.NSAllowsArbitraryLoads is absent or false',
    '  dev-client-keys   no _expo._tcp NSBonjourServices and no dev launcher NSLocalNetworkUsageDescription',
    '  encryption-flag   production: ITSAppUsesNonExemptEncryption set (and equal to the contract)',
    '  test-artefacts    production: no *.storekit and no *.xctest in the bundle',
  ].join('\n'),
};

function validate(options) {
  if (!options.ipa && !options.app) fail('nothing to check: pass --ipa or --app', 'Point it at the exported .ipa (build/ios-release/export/<App>.ipa, or the EAS build artifact).');
  if (!ADS_MODES[options.variant]) fail(`--variant must be preview or production, got "${options.variant ?? ''}"`, 'Pass the APP_VARIANT of the build; only preview and production builds reach TestFlight.');
  if (options.ads !== undefined && !ADS_MODES[options.variant].includes(options.ads)) fail(`--ads ${options.ads} is not allowed with --variant ${options.variant}`, `Use one of: ${ADS_MODES[options.variant].join(', ')}.`);
  if (!/^\d+\.\d+\.\d+$/.test(options.version ?? '') || !/^\d+$/.test(options.build ?? '')) fail('--version X.Y.Z and --build N are required', 'Pass the version and the build number the release used.');
}

/** { app, cleanup } for --app, or for --ipa after unzipping it. */
function locateApp(root, options) {
  if (options.app) {
    const app = resolve(root, options.app);
    if (!existsSync(join(app, 'Info.plist'))) fail(`nothing to check: ${options.app} has no Info.plist`, 'Pass the Payload/<App>.app folder.');
    return { app, shown: toPosix(relative(root, app)), cleanup: () => {} };
  }
  const ipa = resolve(root, options.ipa);
  if (!existsSync(ipa) || !statSync(ipa).isFile()) fail(`nothing to check: ${options.ipa} does not exist`, 'Run the export step first (or download the EAS build artifact).');
  const temp = makeTempDir('store-artifact-');
  const unzip = spawnSync('unzip', ['-q', ipa, '-d', temp], { encoding: 'utf8' });
  if (unzip.status !== 0) fail(`could not unzip ${options.ipa}: ${unzip.stderr.trim()}`, 'The .ipa is a zip file; export it again.');
  const payload = join(temp, 'Payload');
  const name = existsSync(payload) ? readdirSync(payload).find((entry) => entry.endsWith('.app')) : undefined;
  if (!name) fail(`${options.ipa} has no Payload/*.app`, 'Export the archive again.');
  return { app: join(payload, name), shown: `${toPosix(relative(root, ipa))}:Payload/${name}`, cleanup: () => removeTempDir(temp) };
}

function readConfig(app) {
  const path = join(app, 'EXConstants.bundle', 'app.config');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function inputs(root, options) {
  const layout = resolveLayout(root);
  const contractInfo = readReleaseContract(root, layout);
  if (contractInfo.problems.length > 0) fail(`${contractInfo.rel} is not valid (${contractInfo.problems[0].message})`, 'Run check-release-setup.mjs (or fix the key it names) first.');
  const contract = contractDefaults(contractInfo.data);
  const appId = options['app-id'] ?? contract.appId;
  if (!appId) fail(`no production bundle id: pass --app-id or create ${contractInfo.rel}`, "Copy this skill's templates/contracts/ios-release.json and set appId.");
  const xcode = options.xcode ?? readXcodePin(root, layout).version;
  if (!xcode) fail(`no Xcode pin: pass --xcode or keep XCODE_VERSION in ${posix.join(layout.scriptsDir, 'ios', 'toolchain.ts')}`, "Copy this skill's templates/scripts/ios/toolchain.ts.");
  const pkgs = [...new Set(['.', contract.appDir])].map((dir) => readJsonFile(root, posix.join(dir, 'package.json'))).filter((pkg) => pkg !== null);
  return { layout, contract, appId, xcode, pkgs };
}

function adsModeOf(info, extra, options, { pkgs, contract }) {
  const hasAds = 'GADApplicationIdentifier' in info || dependsOn(pkgs, 'react-native-google-mobile-ads');
  if (!hasAds) return null;
  return options.ads ?? (typeof extra.adsMode === 'string' ? extra.adsMode : options.variant === 'production' ? contract.productionAdsMode : 'test');
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (options.rehearsal) console.log('REHEARSAL: not a release gate (--rehearsal: an archive built without the signing key; only the signing rule is SKIP, every other rule stays strict)');
  validate(options);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const base = inputs(root, options);
  const { app, shown, cleanup } = locateApp(root, options);
  try {
    const report = createReporter({ name: 'check-store-artifact', json: options.json });
    const problem = (file, rule, message, fix) => report.problem({ file: file ? `${shown}/${file}` : shown, rule, message, fix });
    const info = readPlist(join(app, 'Info.plist'));
    const config = readConfig(app);
    const extra = config?.extra ?? {};
    const ctx = { root, app, shown, info, config, extra, options, report, problem, ...base, adsMode: adsModeOf(info, extra, options, base) };
    checkIdentity(ctx);
    checkConstants(ctx);
    checkSignature(ctx);
    checkAds(ctx);
    checkPlaceholders(ctx);
    checkRehearsalAdIds(ctx);
    checkUsageStrings(ctx);
    checkBundle(ctx);
    checkMarkers(ctx);
    checkPlistKeys(ctx);
    return report.finish({ checked: 1, unit: `${options.variant} build` });
  } finally {
    cleanup();
  }
});
