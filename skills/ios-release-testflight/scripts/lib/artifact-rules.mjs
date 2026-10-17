// artifact-rules.mjs: the rules check-store-artifact runs on an unpacked .app (a helper, not an entry
// point). Each takes the context check-store-artifact builds:
// { root, app, shown, info, config, extra, options, contract, pkgs, layout, adsMode, report, problem }.
//
//   checkIdentity(ctx)        identity, bundle-id
//   checkConstants(ctx)       constants
//   checkSignature(ctx)       get-task-allow (SKIP only with --rehearsal on an app with no signature)
//   checkAds(ctx)             ad-app-id, and ship-placeholder for the app id itself
//   checkPlaceholders(ctx)    ship-placeholder over Info.plist and EXConstants app.config
//   checkRehearsalAdIds(ctx)  ship-placeholder in the ad ids file, for a keyless production/off rehearsal
//   checkUsageStrings(ctx)    usage-strings
//   checkBundle(ctx)          test-code, forbidden-string
//   checkPlistKeys(ctx)       privacy-manifest, ats, dev-client-keys, encryption-flag, test-artefacts
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail, lineOf, walk } from '../check-lib.mjs';
import { parsePlistXml, readPlist } from './plist.mjs';
import { DEFAULT_AD_IDS_FILE, dependsOn, findSentinels, findTestOnlyGate, variantBundleId, xcodeBuildNumber } from './release-contract.mjs';
import { bundleIdProblem, placeholderProblem, placeholdersIn, placeholdersInText } from './ship-placeholders.mjs';
import { appLanguages, ATT_KEY, usageStringProblems } from './usage-strings.mjs';

export const SAMPLE_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
const ADMOB_APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const URL_OR_HOST = /^[a-z][a-z0-9+.-]*:\/\/|^[\w-]+(\.[\w-]+)+(\/|$)/i;
/** Values another rule judges (bundle-id, ad-app-id), so a placeholder there is one line, not two. */
const OWNED_ELSEWHERE = new Set(['Info.plist GADApplicationIdentifier', 'Info.plist CFBundleIdentifier', 'EXConstants ios.bundleIdentifier']);
const REBUILD = 'then rebuild with a new build number (a gate failure is a code fix: rerun without --resume)';

export function checkIdentity(ctx) {
  const { info, options } = ctx;
  const wantXcode = xcodeBuildNumber(ctx.xcode);
  if (info.CFBundleShortVersionString !== options.version) ctx.problem('Info.plist', 'identity', `CFBundleShortVersionString is "${info.CFBundleShortVersionString ?? 'missing'}", expected ${options.version}`, 'The version comes only from app.config.ts; prebuild again after changing it.');
  if (String(info.CFBundleVersion ?? '') !== options.build) ctx.problem('Info.plist', 'identity', `CFBundleVersion is "${info.CFBundleVersion ?? 'missing'}", expected ${options.build}`, 'The release bumps IOS_BUILD_NUMBER before the archive (EAS remote versioning: the number the build reported); a stale number means the archive predates the bump.');
  if (String(info.DTXcode ?? '') !== wantXcode) ctx.problem('Info.plist', 'identity', `DTXcode is "${info.DTXcode ?? 'missing'}", expected ${wantXcode} (Xcode ${ctx.xcode})`, 'Archive through release:ios, which selects the pinned Xcode with DEVELOPER_DIR (EAS: the image of the build profile).');
  if (info.DTPlatformName !== 'iphoneos') ctx.problem('Info.plist', 'identity', `DTPlatformName is "${info.DTPlatformName ?? 'missing'}", expected iphoneos`, 'Upload a device archive (generic/platform=iOS), never a simulator build.');
  const id = String(info.CFBundleIdentifier ?? '');
  const wanted = variantBundleId(ctx.appId, options.variant);
  const problem = bundleIdProblem(id, { platform: 'ios' });
  const fix = 'The id comes from app.config.ts through app-variant.ts (production <appId>, preview <appId>.preview); export the variant for the whole run and prebuild with --clean.';
  if (problem !== null) ctx.problem('Info.plist', 'bundle-id', `CFBundleIdentifier ${problem}`, fix);
  else if (id !== wanted) ctx.problem('Info.plist', 'bundle-id', `CFBundleIdentifier is ${id}, expected ${wanted} for a ${options.variant} build`, fix);
}

export function checkConstants(ctx) {
  const file = 'EXConstants.bundle/app.config';
  const fix = 'Export APP_VARIANT, EXPO_PUBLIC_APP_VARIANT (and ADS_MODE when not the default) once for the whole run, never per step, and archive again from a clean prebuild.';
  if (ctx.config === null) {
    ctx.problem(file, 'constants', 'EXConstants.bundle/app.config is missing', 'The "Generate app.config" build phase did not run with the build environment; prebuild with --clean and archive again.');
    return;
  }
  const configId = ctx.config.ios?.bundleIdentifier;
  if (typeof configId === 'string' && configId !== ctx.info.CFBundleIdentifier) ctx.problem(file, 'constants', `ios.bundleIdentifier is "${configId}" but Info.plist says "${ctx.info.CFBundleIdentifier}": the variant changed between prebuild and archive`, fix);
  const variant = ctx.extra.appVariant;
  if (variant !== undefined && variant !== ctx.options.variant) ctx.problem(file, 'constants', `extra.appVariant is "${variant}", expected "${ctx.options.variant}"`, fix);
  const ads = ctx.extra.adsMode;
  const allowed = BUILD_ADS_MODES[ctx.options.variant] ?? [];
  if (typeof ads === 'string' && !allowed.includes(ads)) ctx.problem(file, 'constants', `extra.adsMode is "${ads}", which a ${ctx.options.variant} build never carries (allowed: ${allowed.join(', ')})`, 'A testing build shows test ads or none, a store build live ads or none: fix ADS_MODE for this variant (admob-ads-and-consent resolveAdsMode) and archive again.');
  else if (ads !== undefined && ctx.adsMode !== null && ads !== ctx.adsMode) ctx.problem(file, 'constants', `extra.adsMode is "${ads}", expected "${ctx.adsMode}"`, fix);
}

/** The ads modes each uploaded variant may carry (admob-ads-and-consent's pairs). */
const BUILD_ADS_MODES = { preview: ['test', 'off'], production: ['live', 'off'] };

function readEntitlements(ctx) {
  if (ctx.options.entitlements) return readPlist(ctx.options.entitlements);
  const result = spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', ctx.app], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.includes('<plist') ? parsePlistXml(result.stdout) : {};
}

export function checkSignature(ctx) {
  const entitlements = readEntitlements(ctx);
  if (entitlements === null && ctx.options.rehearsal) ctx.report.skip({ file: ctx.shown, rule: 'get-task-allow', message: 'REHEARSAL: the app has no signature (CODE_SIGNING_ALLOWED=NO); the release gate runs on the signed export' });
  else if (entitlements === null) ctx.problem('', 'get-task-allow', 'the app is not signed (codesign -d failed)', 'Export with the team API key (or let EAS sign); an unsigned app cannot be uploaded. A keyless rehearsal archive passes --rehearsal and is never release evidence.');
  else if (entitlements['get-task-allow'] === true) ctx.problem('', 'get-task-allow', 'the entitlements grant get-task-allow (a debug entitlement)', 'Archive the Release configuration; debug-only entitlements (a StoreKit test harness) stay in Debug builds.');
}

export function checkAds(ctx) {
  if (ctx.adsMode === null) return;
  const appId = ctx.info.GADApplicationIdentifier;
  const fix = "react-native-google-mobile-ads' config plugin writes it per variant and ads mode (admob-ads-and-consent); prebuild with --clean.";
  if (typeof appId !== 'string' || appId.trim() === '') {
    ctx.problem('Info.plist', 'ad-app-id', 'GADApplicationIdentifier is missing, and the Google Mobile Ads SDK stops the app at launch without it', fix);
    return;
  }
  if (ctx.adsMode !== 'live') {
    if (appId !== SAMPLE_IOS_APP_ID) ctx.problem('Info.plist', 'ad-app-id', `GADApplicationIdentifier is "${appId}", expected Google's sample app id for an ads-${ctx.adsMode} build`, fix);
    return;
  }
  const placeholder = placeholdersIn(appId)[0];
  if (placeholder) ctx.report.problem(placeholderProblem({ entry: placeholder, value: appId, where: 'Info.plist GADApplicationIdentifier', file: `${ctx.shown}/Info.plist` }));
  else if (!ADMOB_APP_ID.test(appId)) ctx.problem('Info.plist', 'ad-app-id', `GADApplicationIdentifier "${appId}" is not an AdMob app id (ca-app-pub-<16 digits>~<10 digits>)`, fix);
}

function leaves(value, path, out) {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, `${path}.${index}`, out));
  else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, item]) => leaves(item, path === '' ? key : `${path}.${key}`, out));
  return out;
}

/** Production: no placeholder value; every variant: no unfilled __TOKEN__ (the bundle id and the ad app id belong to their own rules). */
export function checkPlaceholders(ctx) {
  const production = ctx.options.variant === 'production';
  const sources = [
    { file: 'Info.plist', label: 'Info.plist', value: ctx.info },
    { file: 'EXConstants.bundle/app.config', label: 'EXConstants', value: ctx.config ?? {} },
  ];
  for (const source of sources) {
    for (const { path, value } of leaves(source.value, '', [])) {
      if (OWNED_ELSEWHERE.has(`${source.label} ${path}`)) continue;
      const entries = placeholdersIn(value).filter((entry) => {
        if (!production) return entry.id === 'template-token';
        // Google's sample AdMob ids are right in a build without live ads (the SDK needs an app id; config plugin options embed it).
        if (entry.id.startsWith('google-sample') && ctx.adsMode !== 'live') return false;
        return entry.id !== 'example-domain' || URL_OR_HOST.test(value.trim());
      });
      for (const entry of entries) ctx.report.problem(placeholderProblem({ entry, value, where: `${source.label} ${path}`, file: `${ctx.shown}/${source.file}` }));
    }
  }
}

/**
 * A production archive with ads off carries Google's sample app id and no units, yet the live build
 * it rehearses carries the app's own ids. So a keyless production/off rehearsal reads them from the
 * ad ids file and reports each placeholder there: the rehearsal names every value still missing.
 * An app whose store build ships with ads off (contract productionAdsMode "off") has no live build
 * to stand in for, so its rehearsal is judged like its release and the file is not read.
 */
export function checkRehearsalAdIds(ctx) {
  const { options } = ctx;
  if (!(options.rehearsal && options.variant === 'production' && ctx.adsMode === 'off' && dependsOn(ctx.pkgs, 'react-native-google-mobile-ads'))) return;
  if (ctx.contract.productionAdsMode === 'off') return;
  const file = ctx.contract.adIdsFile ?? DEFAULT_AD_IDS_FILE;
  const path = join(ctx.root, file);
  if (!existsSync(path)) fail(`${file} not found under the repo root: a production/off rehearsal reads the live AdMob ids from it`, 'Run from the repo root the archive was built from (or pass it as repo-root); set contracts/ios-release.json adIdsFile when the ids live elsewhere, or productionAdsMode "off" when the store build ships without ads.');
  const text = readFileSync(path, 'utf8');
  for (const found of placeholdersInText(text)) {
    if (!found.entry.id.includes('admob')) continue;
    ctx.report.problem(placeholderProblem({ entry: found.entry, value: found.value, where: `${file} (for the live build this production/off rehearsal stands in for)`, file, line: lineOf(text, found.index) }));
  }
}

function trackingRequired(ctx) {
  return dependsOn(ctx.pkgs, 'expo-tracking-transparency') || ATT_KEY in ctx.info;
}

export function checkUsageStrings(ctx) {
  const carried = Object.keys(ctx.info).filter((key) => /^NS[A-Za-z]+UsageDescription$/.test(key));
  const keys = [...new Set([...ctx.contract.usageStrings, ...(trackingRequired(ctx) ? [ATT_KEY] : []), ...carried])].sort();
  if (keys.length === 0) return;
  const base = typeof ctx.info.CFBundleDevelopmentRegion === 'string' ? ctx.info.CFBundleDevelopmentRegion : null;
  const languages = appLanguages(ctx.app, ctx.info).filter((lang) => lang !== base);
  const fix = "Set the text in app.config.ts (ios.infoPlist or the library's config plugin option) and each language's in the app config locales, then prebuild with --clean; iOS terminates an app that uses the API without it (permissions-and-system-prompts owns the wording).";
  for (const found of usageStringProblems(ctx.app, ctx.info, { keys, languages, readPlist })) ctx.problem(found.file, 'usage-strings', found.message, fix);
}

export function checkBundle(ctx) {
  const bundlePath = join(ctx.app, 'main.jsbundle');
  if (!existsSync(bundlePath)) {
    ctx.problem('main.jsbundle', 'test-code', 'main.jsbundle is missing, so no JS was embedded', 'Archive the Release configuration, which embeds the Hermes bundle.');
    return;
  }
  const text = readFileSync(bundlePath).toString('latin1');
  const sentinels = findSentinels(ctx.root, ctx.layout, ctx.options.sentinel, ctx.contract.appDir);
  if (sentinels.length === 0) {
    const gate = findTestOnlyGate(ctx.root, ctx.layout, ctx.contract.appDir);
    if (gate !== null) ctx.report.problem({ file: gate, line: 1, rule: 'test-code', message: `${gate} gates test-only code, but no test-only sentinel is known: the gate cannot prove whether that code shipped`, fix: "Export one from the test-only entry (export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY'), list it in rn-skills.config.json testOnlySentinels, or pass --sentinel <text>." });
    else ctx.report.note('test-code: the app has no test-only gate and no sentinel, so there is no test-only code to look for');
  }
  for (const sentinel of sentinels) {
    const count = text.split(sentinel).length - 1;
    if (ctx.options.variant === 'production' && count > 0) ctx.problem('main.jsbundle', 'test-code', `contains the test-only sentinel "${sentinel}" ${count} time(s): the debug menu and test hooks would ship`, `Key Metro's cache on the public variables, gate test-only code behind the literal variant comparison, export the variant for the whole run, ${REBUILD}.`);
    if (ctx.options.variant === 'preview' && count === 0) ctx.problem('main.jsbundle', 'test-code', `lacks the test-only sentinel "${sentinel}": the preview build was bundled as production`, 'Export APP_VARIANT=preview and EXPO_PUBLIC_APP_VARIANT=preview for the whole run and archive again.');
  }
  for (const forbidden of ctx.contract.forbiddenBundleStrings) {
    if (text.includes(forbidden)) ctx.problem('main.jsbundle', 'forbidden-string', `contains "${forbidden}" (contracts/ios-release.json forbiddenBundleStrings): unfinished work would reach testers`, `Finish or remove what uses it, ${REBUILD}.`);
  }
}

export function checkMarkers(ctx) {
  for (const marker of ctx.contract.unfinishedMarkers) {
    if (existsSync(join(ctx.root, marker))) ctx.report.problem({ file: marker, line: 0, rule: 'unfinished-marker', message: 'the repo the build came from still marks unfinished work (contracts/ios-release.json unfinishedMarkers)', fix: 'Finish the work it lists and delete the marker, then rebuild.' });
  }
}

export function checkPlistKeys(ctx) {
  const { info } = ctx;
  if (!existsSync(join(ctx.app, 'PrivacyInfo.xcprivacy'))) ctx.problem('PrivacyInfo.xcprivacy', 'privacy-manifest', 'the privacy manifest is missing', 'Declare the required-reason APIs in app.config.ts ios.privacyManifests (privacy-and-store-declarations) and prebuild with --clean.');
  if (info.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true) ctx.problem('Info.plist', 'ats', 'NSAppTransportSecurity.NSAllowsArbitraryLoads is true', 'Remove the ATS exception; allow one domain with NSExceptionDomains only when a server truly cannot speak HTTPS.');
  if (Array.isArray(info.NSBonjourServices) && info.NSBonjourServices.includes('_expo._tcp')) ctx.problem('Info.plist', 'dev-client-keys', 'NSBonjourServices holds _expo._tcp, a development-client key a Release archive strips', 'Archive the Release configuration and keep the dev launcher build phase that strips local-network keys; never add _expo._tcp by hand.');
  if (String(info.NSLocalNetworkUsageDescription ?? '').includes('Expo Dev Launcher')) ctx.problem('Info.plist', 'dev-client-keys', "NSLocalNetworkUsageDescription is the dev launcher's text, which a Release archive strips", 'Archive the Release configuration; set an own NSLocalNetworkUsageDescription only when the app really uses the local network.');
  if (ctx.options.variant !== 'production') return;
  const flag = info.ITSAppUsesNonExemptEncryption;
  const want = ctx.contract.usesNonExemptEncryption;
  if (typeof flag !== 'boolean') ctx.problem('Info.plist', 'encryption-flag', 'ITSAppUsesNonExemptEncryption is not set, so App Store Connect asks the export-compliance question for every build', 'Set ios.config.usesNonExemptEncryption in app.config.ts (false for an app that uses only exempt encryption such as HTTPS).');
  else if (want !== null && flag !== want) ctx.problem('Info.plist', 'encryption-flag', `ITSAppUsesNonExemptEncryption is ${flag}, the contract says ${want}`, 'Make app.config.ts and contracts/ios-release.json agree (the answer is a legal statement: ask the developer when unsure).');
  const found = walk(ctx.app, { include: ['*.storekit', '*.xctest'] }).map((rel) => /^(.*?\.(?:xctest|storekit))(?:\/|$)/.exec(rel)?.[1] ?? rel);
  for (const rel of [...new Set(found)]) ctx.problem(rel, 'test-artefacts', 'a StoreKit test configuration or test bundle is inside a production build', `StoreKit test files belong to a throwaway Debug prebuild (in-app-purchases); prebuild with --clean, ${REBUILD}.`);
}

