#!/usr/bin/env node
// check-sim-app.mjs: checks a built Release simulator app (the .app folder xcodebuild wrote, or the
// one an EAS simulator build archive holds) against the variant it claims to be: the pinned Xcode
// built it, test-only code is present (development, preview) or absent (production), the three
// moments the variant enters the binary agree, its identity, usage strings, placeholders and the
// Info.plist keys a store build needs. This is how "the production build carries no test code" is
// proven before any release.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-sim-app.mjs . --app <path.app> --variant preview
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, readProjectConfig, requireDir, resolveLayout, run, toPosix, UsageError } from './check-lib.mjs';
import { readPlist } from './lib/plist.mjs';
import { readJsonFile, readSimContract, readXcodePin, xcodeBuildNumber } from './lib/sim-contract.mjs';
import { checkIdentity, checkInfoKeys, checkPlaceholders, checkStoreArtefacts, checkUsageStrings } from './lib/sim-app-rules.mjs';
import { checkTestCode } from './lib/sim-app-sentinels.mjs';

const VARIANTS = ['development', 'preview', 'production'];

const SPEC = {
  name: 'check-sim-app',
  summary: 'Checks a built Release simulator .app against its variant: the pinned Xcode, the simulator platform, test-only code present or absent, the variant in Info.plist and EXConstants, the bundle id, usage strings, placeholders and the Info.plist keys a store build needs.',
  usage: '[repo-root] --app <path.app> --variant development|preview|production [options]',
  options: {
    app: { type: 'string', value: 'path', help: 'The built .app folder, relative to the repo root (build:ios:sim prints it: build/ios-sim/dd/Build/Products/Release-iphonesimulator/<Scheme>.app)' },
    variant: { type: 'string', value: 'name', help: 'APP_VARIANT the build was made with: development, preview or production' },
    xcode: { type: 'string', value: 'version', help: 'Xcode version the build must come from (default: XCODE_VERSION in scripts/ios/toolchain.ts)' },
    platform: { type: 'string', value: 'name', default: 'iphonesimulator', help: 'DTPlatformName: iphonesimulator, or iphoneos for a device build' },
    'min-ios': { type: 'string', value: 'version', help: 'Expected MinimumOSVersion (default: the contract deploymentTarget; never below 16.4)' },
    version: { type: 'string', value: 'x.y.z', help: 'Expected CFBundleShortVersionString (the app config version)' },
    build: { type: 'string', value: 'n', help: 'Expected CFBundleVersion (the build number)' },
    'app-dir': { type: 'string', value: 'dir', help: "The app package folder (its package.json and app.config.*) relative to the repo root (default '.'; when multi-package, e.g. apps/mobile). Its dependencies and the root's both count" },
    sentinel: { type: 'string', multiple: true, value: 'text', help: 'A string only test-only code contains (default: every exported *SENTINEL* constant under src/, plus rn-skills.config.json testOnlySentinels)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  built-with-xcode      DTXcode matches the pinned Xcode (26.6 -> 2660, 26.6.1 -> 2661)',
    '  platform              DTPlatformName matches --platform',
    '  min-ios               MinimumOSVersion is at least 16.4 (the Expo SDK 57 floor) and equals the contract deploymentTarget / --min-ios',
    '                        (a major alone, "26", equals "26.0")',
    '  test-code             main.jsbundle exists (Release embeds it); every test-only sentinel is in a development or preview',
    '                        bundle and none is in a production bundle. A test-only gate without a sentinel is a problem;',
    '                        SKIP while the app has no gate (debug-menu-and-test-hooks creates src/test-only.ts)',
    '  constants-variant     EXConstants.bundle/app.config exists and its ios.bundleIdentifier (and extra.appVariant, when set)',
    '                        agrees with Info.plist and --variant: the variables did not change between prebuild and xcodebuild',
    '  bundle-id             CFBundleIdentifier is a valid iOS id and the variant\'s own: <appId>.dev, <appId>.preview, <appId>',
    '  ship-placeholder      production: no placeholder value (com.example.*, Google sample AdMob ids, example.com links) in',
    '                        Info.plist or EXConstants; every variant: no unfilled __PLACEHOLDER__',
    '  ad-app-id             with react-native-google-mobile-ads: GADApplicationIdentifier is present and well formed',
    '  usage-strings         every contract usageStrings key and every NS*UsageDescription the app carries is in Info.plist and',
    '                        in every language the app is localized into; NSUserTrackingUsageDescription is required too',
    '                        with expo-tracking-transparency (or react-native-google-mobile-ads with userTrackingUsageDescription)',
    '  info-keys             every contract infoPlist key has its value',
    '  privacy-manifest      PrivacyInfo.xcprivacy is in the bundle',
    '  ats                   NSAppTransportSecurity.NSAllowsArbitraryLoads is absent or false',
    '  encryption-flag       production: ITSAppUsesNonExemptEncryption is set (and equals the contract usesNonExemptEncryption)',
    '  store-test-artefacts  production: no *.storekit and no *.xctest in the bundle',
    '  version, build-number match --version / --build when given',
    'Dependencies (ads SDK, tracking) are read from package.json at the root and in --app-dir; the app config from --app-dir, else the root.',
    'Example: node check-sim-app.mjs . --app build/ios-sim/dd/Build/Products/Release-iphonesimulator/Tasks.app --variant production',
  ].join('\n'),
};

const SDK_FLOOR = '16.4';

function versionParts(value) {
  return String(value ?? '').split('.').map((part) => Number(part) || 0);
}

function isBelow(value, floor) {
  const [a1 = 0, a2 = 0] = versionParts(value);
  const [b1 = 0, b2 = 0] = versionParts(floor);
  return a1 < b1 || (a1 === b1 && a2 < b2);
}

/** Same version once padded: the app config accepts a major alone ("26"), which Xcode writes as "26.0". */
function sameVersion(a, b) {
  const [a1 = 0, a2 = 0, a3 = 0] = versionParts(a);
  const [b1 = 0, b2 = 0, b3 = 0] = versionParts(b);
  return a1 === b1 && a2 === b2 && a3 === b3;
}

function readInputs(root, options) {
  if (!options.app) fail('nothing to check: --app is required', 'Pass the built .app folder that build:ios:sim printed.');
  if (!VARIANTS.includes(options.variant)) fail(`--variant must be one of ${VARIANTS.join('|')}, got "${options.variant ?? ''}"`, 'Pass the APP_VARIANT the build was made with.');
  const app = resolve(root, options.app);
  if (!existsSync(app) || !statSync(app).isDirectory()) fail(`nothing to check: ${options.app} is not a folder`, 'Pass the .app folder (extract it from an EAS simulator archive first), not the .ipa or the workspace.');
  if (!existsSync(join(app, 'Info.plist'))) fail(`nothing to check: ${options.app}/Info.plist does not exist`, 'Pass a complete .app folder produced by xcodebuild.');
  const shown = toPosix(relative(root, app));
  return { app, where: shown.startsWith('..') ? toPosix(app) : shown, info: readPlist(join(app, 'Info.plist')) };
}

function readPackageJson(root, rel) {
  const pkg = readJsonFile(root, rel);
  if (pkg !== null && (typeof pkg !== 'object' || Array.isArray(pkg))) throw new UsageError(`${rel} is not a JSON object`, `Fix ${rel}.`);
  return pkg;
}

function contractData(root, layout) {
  const contract = readSimContract(root, layout);
  if (contract.problems.length > 0) fail(`${contract.rel} is not valid (${contract.problems[0].message})`, 'Run check-sim-setup.mjs, which names every invalid key, and fix the contract.');
  return contract.data;
}

function checkToolchain(ctx) {
  const file = `${ctx.where}/Info.plist`;
  const wanted = xcodeBuildNumber(ctx.xcode);
  if (String(ctx.info.DTXcode ?? '') !== wanted) ctx.report.problem({ file, rule: 'built-with-xcode', message: `DTXcode is "${ctx.info.DTXcode ?? 'missing'}", expected ${wanted} (Xcode ${ctx.xcode})`, fix: 'Build through npm run build:ios:sim, which selects the pinned Xcode with DEVELOPER_DIR; never xcode-select or whichever Xcode is named Xcode.app.' });
  if (ctx.info.DTPlatformName !== ctx.options.platform) ctx.report.problem({ file, rule: 'platform', message: `DTPlatformName is "${ctx.info.DTPlatformName ?? 'missing'}", expected ${ctx.options.platform}`, fix: 'Check the -sdk and -destination of the xcodebuild call (xcodebuildSimArgs).' });
  const minimum = ctx.info.MinimumOSVersion;
  const expected = ctx.options['min-ios'] ?? ctx.contract.deploymentTarget ?? null;
  if (typeof minimum !== 'string' || isBelow(minimum, SDK_FLOOR)) ctx.report.problem({ file, rule: 'min-ios', message: `MinimumOSVersion is "${minimum ?? 'missing'}", below ${SDK_FLOOR} (the Expo SDK 57 floor)`, fix: 'Leave the deployment target at the SDK default or set the built-in ios.deploymentTarget in app.config.ts to 16.4 or newer (not expo-build-properties, whose option is deprecated since SDK 56), then prebuild with --clean.' });
  else if (expected !== null && !sameVersion(minimum, expected)) ctx.report.problem({ file, rule: 'min-ios', message: `MinimumOSVersion is "${minimum}", expected ${expected}`, fix: 'Set the built-in ios.deploymentTarget in app.config.ts (MAJOR.MINOR or a major alone; the expo-build-properties option is deprecated since SDK 56) to the contract deploymentTarget, and prebuild with --clean.' });
}

function readConstants(ctx) {
  const file = `${ctx.where}/EXConstants.bundle/app.config`;
  const path = join(ctx.app, 'EXConstants.bundle', 'app.config');
  const fix = 'The "Generate app.config for prebuilt Constants.manifest" build phase did not run with the build\'s environment; prebuild with --clean and build again through build:ios:sim.';
  if (!existsSync(path)) {
    ctx.report.problem({ file, rule: 'constants-variant', message: 'EXConstants.bundle/app.config is missing', fix });
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    ctx.report.problem({ file, rule: 'constants-variant', message: `is not JSON (${error.message})`, fix });
    return null;
  }
}

function checkConstants(ctx, config) {
  if (config === null) return;
  const file = `${ctx.where}/EXConstants.bundle/app.config`;
  const fix = 'Export APP_VARIANT and EXPO_PUBLIC_APP_VARIANT once for the whole run (variantEnv), never per step, and build again from a clean prebuild.';
  const configId = config.ios?.bundleIdentifier;
  if (typeof configId === 'string' && configId !== ctx.info.CFBundleIdentifier) ctx.report.problem({ file, rule: 'constants-variant', message: `ios.bundleIdentifier is "${configId}" but Info.plist says "${ctx.info.CFBundleIdentifier}": the variant changed between prebuild and xcodebuild`, fix });
  const extraVariant = config.extra?.appVariant;
  if (extraVariant !== undefined && extraVariant !== ctx.options.variant) ctx.report.problem({ file, rule: 'constants-variant', message: `extra.appVariant is "${extraVariant}", expected "${ctx.options.variant}"`, fix });
}

function checkPlistBasics(ctx) {
  const file = `${ctx.where}/Info.plist`;
  const { info, options, app } = ctx;
  if (!existsSync(join(app, 'PrivacyInfo.xcprivacy'))) ctx.report.problem({ file: `${ctx.where}/PrivacyInfo.xcprivacy`, rule: 'privacy-manifest', message: 'PrivacyInfo.xcprivacy is missing from the bundle', fix: 'Declare the required-reason APIs in app.config.ts ios.privacyManifests (privacy-and-store-declarations owns the list) and prebuild with --clean.' });
  if (info.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true) ctx.report.problem({ file, rule: 'ats', message: 'NSAppTransportSecurity.NSAllowsArbitraryLoads is true', fix: 'Remove the ATS exception: the app talks HTTPS through its ApiClient; allow a single domain with NSExceptionDomains only when a server truly cannot.' });
  if (options.variant === 'production') {
    const flag = info.ITSAppUsesNonExemptEncryption;
    const wanted = ctx.contract.usesNonExemptEncryption;
    if (typeof flag !== 'boolean') ctx.report.problem({ file, rule: 'encryption-flag', message: 'ITSAppUsesNonExemptEncryption is not set, so App Store Connect asks the export-compliance question for every upload', fix: 'Set ios.config.usesNonExemptEncryption in app.config.ts (false for an app that uses only exempt encryption such as HTTPS).' });
    else if (wanted !== undefined && flag !== wanted) ctx.report.problem({ file, rule: 'encryption-flag', message: `ITSAppUsesNonExemptEncryption is ${flag}, the contract says ${wanted}`, fix: 'Make app.config.ts ios.config.usesNonExemptEncryption and the contract agree (the answer is a legal statement: ask the developer when unsure).' });
  }
  if (options.version && info.CFBundleShortVersionString !== options.version) ctx.report.problem({ file, rule: 'version', message: `CFBundleShortVersionString is "${info.CFBundleShortVersionString}", expected ${options.version}`, fix: 'The version comes from the app config only; prebuild with --clean after changing it.' });
  if (options.build && String(info.CFBundleVersion) !== options.build) ctx.report.problem({ file, rule: 'build-number', message: `CFBundleVersion is "${info.CFBundleVersion}", expected ${options.build}`, fix: 'The build number comes from the app config (or EAS remote versions) only; prebuild with --clean after changing it.' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const { app, where, info } = readInputs(root, options);
  const layout = resolveLayout(root);
  const contract = contractData(root, layout);
  const xcode = options.xcode ?? readXcodePin(root, layout).version;
  if (!xcode) fail(`no Xcode pin: ${posix.join(layout.scriptsDir, 'ios', 'toolchain.ts')} does not pin XCODE_VERSION`, 'Pass --xcode <version>, or copy the skill\'s templates/scripts/ios/toolchain.ts.');
  const report = createReporter({ name: 'check-sim-app', json: options.json });
  const appDir = posix.normalize(options['app-dir'] ?? '.');
  requireDir(join(root, appDir), 'app folder (--app-dir)');
  const pkgs = [...new Set([appDir, '.'])].map((dir) => readPackageJson(root, posix.join(dir, 'package.json'))).filter((pkg) => pkg !== null);
  const ctx = { root, appDir, app, where, info, options, xcode, layout, contract, pkgs, report, projectConfig: readProjectConfig(root) };
  checkToolchain(ctx);
  checkTestCode(ctx);
  const config = readConstants(ctx);
  checkConstants(ctx, config);
  checkIdentity(ctx);
  checkPlaceholders(ctx, config);
  checkUsageStrings(ctx);
  checkInfoKeys(ctx);
  checkPlistBasics(ctx);
  checkStoreArtefacts(ctx);
  return report.finish({ checked: 1, unit: `app (${options.variant})` });
});
