// sim-app-rules.mjs: the identity, placeholder, ads, usage-string, Info.plist and store rules of
// check-sim-app (a helper, not an entry point). Each check takes the context check-sim-app builds:
// { root, appDir, app, where, info, options, contract, pkgs, report } (pkgs: the app package's
// package.json and the root one; a dependency in either counts).
//
//   checkIdentity(ctx)               bundle-id, ad-app-id
//   checkPlaceholders(ctx, config)   ship-placeholder over Info.plist and EXConstants app.config
//   checkUsageStrings(ctx)           usage-strings
//   trackingRequired(ctx)            true when the app can ask for tracking authorization (ATT key required)
//   checkInfoKeys(ctx)               info-keys
//   checkStoreArtefacts(ctx)         store-test-artefacts
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { walk } from '../check-lib.mjs';
import { readPlist } from './plist.mjs';
import { placeholderProblem, placeholdersIn } from './ship-placeholders.mjs';
import { appLanguages, ATT_KEY, usageStringProblems } from './usage-strings.mjs';

/** The suffix app-variants-and-environment's variantIdentity gives each variant's id. */
export const VARIANT_SUFFIX = Object.freeze({ development: '.dev', preview: '.preview', production: '' });

const IOS_BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const ADMOB_APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;
const APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.json'];
const URL_OR_HOST = /^[a-z][a-z0-9+.-]*:\/\/|^[\w-]+(\.[\w-]+)+(\/|$)/i;

function expectedIdProblem(id, variant, appId) {
  const suffix = VARIANT_SUFFIX[variant];
  if (appId !== undefined) return id === `${appId}${suffix}` ? null : `is "${id}", expected "${appId}${suffix}" for a ${variant} build`;
  if (variant === 'production') return /\.(dev|preview)$/.test(id) ? `is "${id}", a testing variant's id, in a production build` : null;
  return id.endsWith(suffix) ? null : `is "${id}", but a ${variant} build's id ends in ${suffix} (it installs beside the store app)`;
}

/** A dependency (or devDependency) of the app package or the repo root. */
function dependsOn(ctx, name) {
  return ctx.pkgs.some((pkg) => pkg?.dependencies?.[name] !== undefined || pkg?.devDependencies?.[name] !== undefined);
}

/** bundle-id and ad-app-id. */
export function checkIdentity(ctx) {
  const file = `${ctx.where}/Info.plist`;
  const id = String(ctx.info.CFBundleIdentifier ?? '');
  const idFix = 'The id comes from variantIdentity() in app.config.ts (app-variants-and-environment): <appId>.dev, <appId>.preview, <appId>; build with the variant exported for the whole run, from a clean prebuild.';
  if (!IOS_BUNDLE_ID.test(id)) ctx.report.problem({ file, rule: 'bundle-id', message: `CFBundleIdentifier "${id}" is not a valid iOS bundle id`, fix: idFix });
  else {
    const problem = expectedIdProblem(id, ctx.options.variant, ctx.contract.appId);
    if (problem !== null) ctx.report.problem({ file, rule: 'bundle-id', message: `CFBundleIdentifier ${problem}`, fix: idFix });
  }
  const usesAds = dependsOn(ctx, 'react-native-google-mobile-ads') || 'GADApplicationIdentifier' in ctx.info;
  if (!usesAds) return;
  const appId = ctx.info.GADApplicationIdentifier;
  const adFix = "react-native-google-mobile-ads' config plugin writes it from iosAppId (admob-ads-and-consent selects the id per variant); prebuild with --clean.";
  if (typeof appId !== 'string' || appId.trim() === '') ctx.report.problem({ file, rule: 'ad-app-id', message: 'GADApplicationIdentifier is missing, and the Google Mobile Ads SDK stops the app at launch without it', fix: adFix });
  else if (!ADMOB_APP_ID.test(appId)) ctx.report.problem({ file, rule: 'ad-app-id', message: `GADApplicationIdentifier "${appId}" is not an AdMob app id (ca-app-pub-<16 digits>~<10 digits>)`, fix: adFix });
}

function leaves(value, path, out) {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, `${path}.${index}`, out));
  else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, item]) => leaves(item, path === '' ? key : `${path}.${key}`, out));
  return out;
}

function placeholderEntries(value, production) {
  return placeholdersIn(value).filter((entry) => {
    if (!production) return entry.id === 'template-token';
    return entry.id !== 'example-domain' || URL_OR_HOST.test(value.trim());
  });
}

/** ship-placeholder: production builds carry no placeholder; no build carries an unfilled token. */
export function checkPlaceholders(ctx, config) {
  const production = ctx.options.variant === 'production';
  const sources = [
    { file: `${ctx.where}/Info.plist`, label: 'Info.plist', value: ctx.info },
    { file: `${ctx.where}/EXConstants.bundle/app.config`, label: 'EXConstants', value: config ?? {} },
  ];
  for (const source of sources) {
    for (const { path, value } of leaves(source.value, '', [])) {
      for (const entry of placeholderEntries(value, production)) ctx.report.problem(placeholderProblem({ entry, value, where: `${source.label} ${path}`, file: source.file }));
    }
  }
}

/**
 * The app can request tracking authorization: it depends on expo-tracking-transparency, or on
 * react-native-google-mobile-ads with its ATT option (userTrackingUsageDescription) in the app config.
 * iOS terminates an app that requests it without NSUserTrackingUsageDescription, so the key is then
 * required like the AdMob app id is with the ads SDK (admob-ads-and-consent owns the flow).
 */
export function trackingRequired(ctx) {
  if (dependsOn(ctx, 'expo-tracking-transparency')) return true;
  if (!dependsOn(ctx, 'react-native-google-mobile-ads')) return false;
  // The app folder's config files (app.json feeds app.config.*, so any of them counts), else the root's.
  const inDir = (dir) => APP_CONFIGS.map((name) => join(ctx.root, posix.join(dir, name))).filter((path) => existsSync(path));
  const found = inDir(ctx.appDir ?? '.');
  return (found.length > 0 ? found : inDir('.')).some((path) => /\buserTrackingUsageDescription\b/.test(readFileSync(path, 'utf8')));
}

/** usage-strings: contract keys, the tracking key when the app can ask for it, and every NS*UsageDescription the app carries, in every language. */
export function checkUsageStrings(ctx) {
  const carried = Object.keys(ctx.info).filter((key) => /^NS[A-Za-z]+UsageDescription$/.test(key));
  const derived = trackingRequired(ctx) ? [ATT_KEY] : [];
  const keys = [...new Set([...(ctx.contract.usageStrings ?? []), ...derived, ...carried])].sort();
  if (keys.length === 0) return;
  const fix = "Set the text in app.config.ts (ios.infoPlist or the library's config plugin option) and each language's in the app config locales (<lang>.json ios object), then prebuild with --clean; permissions-and-system-prompts owns the wording.";
  // A key missing from the development region's InfoPlist.strings falls back to the Info.plist text,
  // which is written in that language; in every other language the user would read it untranslated.
  const base = typeof ctx.info.CFBundleDevelopmentRegion === 'string' ? ctx.info.CFBundleDevelopmentRegion : null;
  const languages = appLanguages(ctx.app, ctx.info).filter((lang) => lang !== base);
  for (const found of usageStringProblems(ctx.app, ctx.info, { keys, languages, readPlist })) ctx.report.problem({ file: `${ctx.where}/${found.file}`, rule: 'usage-strings', message: found.message, fix });
}

/** info-keys: every contract infoPlist key carries exactly its value. */
export function checkInfoKeys(ctx) {
  for (const [key, want] of Object.entries(ctx.contract.infoPlist ?? {})) {
    if (ctx.info[key] !== want) ctx.report.problem({ file: `${ctx.where}/Info.plist`, rule: 'info-keys', message: `${key} is ${JSON.stringify(ctx.info[key] ?? 'missing')}, the contract expects ${JSON.stringify(want)}`, fix: `Set ios.infoPlist.${key} in app.config.ts (or the plugin that owns it) and prebuild with --clean.` });
  }
}

/** store-test-artefacts: no StoreKit test configuration or test bundle in a production build. */
export function checkStoreArtefacts(ctx) {
  if (ctx.options.variant !== 'production') return;
  const found = walk(ctx.app, { include: ['*.storekit', '*.xctest'] }).map((rel) => /^(.*?\.(?:xctest|storekit))(?:\/|$)/.exec(rel)?.[1] ?? rel);
  for (const rel of [...new Set(found)]) {
    ctx.report.problem({ file: `${ctx.where}/${rel}`, rule: 'store-test-artefacts', message: 'a StoreKit test configuration or test bundle sits inside a production build', fix: 'StoreKit test files belong to testing builds only (in-app-purchases); build the production variant from a clean prebuild.' });
  }
}
