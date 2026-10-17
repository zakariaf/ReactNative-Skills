// release-contract.mjs: reads the repo facts both checkers of this skill share (a helper, not an
// entry point): contracts/ios-release.json (validated key by key, defaults applied), the Xcode pin
// in scripts/ios/toolchain.ts, package.json, and the app's test-only sentinels.
//
//   CONTRACT_NAME                     'ios-release.json' (inside layout.contractsDir)
//   readJsonFile(root, rel)           parsed JSON or null when absent; UsageError when malformed
//   readReleaseContract(root, layout) { rel, exists, data, problems: [{ line, message, fix }] }
//   contractDefaults(data)            data with every default filled in
//   readXcodePin(root, layout)        { rel, version } (version null when not pinned)
//   xcodeBuildNumber(version)         the DTXcode an Xcode writes: '26.6' -> '2660'
//   variantBundleId(appId, variant)   <appId> for production, <appId>.preview, <appId>.dev
//   dependsOn(pkgs, name)             a dependency or devDependency of any of the package.json objects
//   appSourceDirs(layout, appDir)     where the app source lives: srcDir, plus <appDir>/src when multi-package
//   findSentinels(root, layout, extra, appDir) exported *SENTINEL* string constants in the app source,
//                                     plus rn-skills.config.json testOnlySentinels; `extra` replaces both
//   findTestOnlyGate(root, layout, appDir) the first test-only.ts under the app source, or null
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { readProjectConfig, UsageError, walkRepo } from '../check-lib.mjs';

export const CONTRACT_NAME = 'ios-release.json';
export const DEFAULT_AD_IDS_FILE = 'src/config/admob-ids.ts';

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const TOKEN = /__[A-Z][A-Z0-9_]*__/;
const USAGE_KEY = /^NS[A-Za-z]+UsageDescription$/;

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isTexts = (value, test = isText) => Array.isArray(value) && value.every(test) && new Set(value).size === value.length;
const isRelative = (value) => isText(value) && !value.startsWith('/') && !value.split('/').includes('..');
const isChangeCheck = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && isTexts(value.paths) && value.paths.length > 0 && isText(value.line) && Object.keys(value).every((key) => ['paths', 'line'].includes(key));
const isWhatToTest = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every((key) => ['always', 'whenChanged'].includes(key))
  && (value.always === undefined || isTexts(value.always))
  && (value.whenChanged === undefined || (Array.isArray(value.whenChanged) && value.whenChanged.every(isChangeCheck)));

/** Each key: [check(value) -> true when valid, what a valid value is]. */
const KEYS = {
  $schema: [isText, 'a string'],
  $comment: [isText, 'a string'],
  appId: [(value) => typeof value === 'string' && BUNDLE_ID.test(value), 'a reverse-DNS bundle id such as "com.acme.tasks"'],
  appDir: [isRelative, 'a repo-relative folder ("." for a single app)'],
  releaseBranch: [isText, 'a branch name such as "main"'],
  preflight: [(value) => isTexts(value), 'a list of npm script names without duplicates'],
  postPrebuild: [(value) => isTexts(value), 'a list of npm script names without duplicates'],
  usageStrings: [(value) => isTexts(value, (key) => typeof key === 'string' && USAGE_KEY.test(key)), 'a list of NS*UsageDescription keys without duplicates'],
  usesNonExemptEncryption: [(value) => typeof value === 'boolean', 'true or false'],
  forbiddenBundleStrings: [(value) => isTexts(value, (text) => isText(text) && text.length >= 6), 'a list of strings of at least 6 characters'],
  unfinishedMarkers: [(value) => isTexts(value, isRelative), 'a list of repo-relative paths'],
  adIdsFile: [isRelative, 'a repo-relative file such as "src/config/admob-ids.ts"'],
  productionAdsMode: [(value) => value === 'live' || value === 'off', '"live" or "off"'],
  whatToTest: [isWhatToTest, '{ "always": [lines], "whenChanged": [{ "paths": [prefixes], "line": "..." }] }'],
};

/** Parsed JSON of a repo file, or null when it does not exist. A malformed file is bad input. */
export function readJsonFile(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON (${error.message})`, `Fix the JSON in ${rel}.`);
  }
}

function lineOfKey(text, key) {
  const index = text.indexOf(`"${key}"`);
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
}

function tokenIn(value) {
  if (typeof value === 'string') return TOKEN.test(value) ? value : null;
  if (Array.isArray(value)) return value.map(tokenIn).find((found) => found !== null) ?? null;
  if (value !== null && typeof value === 'object') return Object.values(value).map(tokenIn).find((found) => found !== null) ?? null;
  return null;
}

/** The contract with every valid key in `data` (an invalid key is left out and reported). */
export function readReleaseContract(root, layout) {
  const rel = posix.join(layout.contractsDir, CONTRACT_NAME);
  const raw = readJsonFile(root, rel);
  if (raw === null) return { rel, exists: false, data: {}, problems: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError(`${rel} is not a JSON object`, "Start from the skill's templates/contracts/ios-release.json.");
  const text = readFileSync(join(root, rel), 'utf8');
  const data = {};
  const problems = [];
  for (const [key, value] of Object.entries(raw)) {
    const rule = KEYS[key];
    const line = lineOfKey(text, key);
    const token = tokenIn(value);
    if (rule === undefined) problems.push({ line, message: `unknown key "${key}"`, fix: `Remove it; the keys are ${Object.keys(KEYS).filter((name) => !name.startsWith('$')).join(', ')} (templates/contracts/ios-release.schema.json).` });
    else if (token !== null) problems.push({ line, message: `"${key}" still holds the template placeholder ${token}`, fix: `Replace it with the app's value${key === 'appId' ? '' : ` (or remove "${key}" to use the default)`}.` });
    else if (!rule[0](value)) problems.push({ line, message: `"${key}" is ${JSON.stringify(value)}, not ${rule[1]}`, fix: `Set "${key}" to ${rule[1]}${key === 'appId' ? '' : `, or remove it to use the default`}.` });
    else data[key] = value;
  }
  if (!('appId' in raw)) problems.push({ line: 1, message: 'has no "appId"', fix: 'Set "appId" to the production bundle id the App Store Connect app record carries.' });
  if (Array.isArray(data.preflight) && !data.preflight.includes('verify')) problems.push({ line: lineOfKey(text, 'preflight'), message: '"preflight" does not run verify', fix: 'Keep "verify" in the list: a release builds only a commit whose full gate is green (quality-gates).' });
  return { rel, exists: true, data, problems };
}

/** The contract data with every default filled in. */
export function contractDefaults(data) {
  return {
    appId: data.appId ?? null,
    appDir: data.appDir ?? '.',
    releaseBranch: data.releaseBranch ?? 'main',
    preflight: data.preflight ?? ['verify'],
    postPrebuild: data.postPrebuild ?? [],
    usageStrings: data.usageStrings ?? [],
    usesNonExemptEncryption: data.usesNonExemptEncryption ?? null,
    forbiddenBundleStrings: data.forbiddenBundleStrings ?? [],
    unfinishedMarkers: data.unfinishedMarkers ?? [],
    adIdsFile: data.adIdsFile ?? null,
    productionAdsMode: data.productionAdsMode ?? 'live',
  };
}

/** The Xcode pin: scripts/ios/toolchain.ts XCODE_VERSION = '<major>.<minor>[.<patch>]'. */
export function readXcodePin(root, layout) {
  const rel = posix.join(layout.scriptsDir, 'ios', 'toolchain.ts');
  const path = join(root, rel);
  if (!existsSync(path)) return { rel, version: null };
  const match = /export\s+const\s+XCODE_VERSION\s*=\s*'(\d+\.\d+(?:\.\d+)?)'/.exec(readFileSync(path, 'utf8'));
  return { rel, version: match ? match[1] : null };
}

/** The DTXcode a given Xcode writes, like toolchain.ts xcodeBuildNumber: major + minor + (patch or 0). */
export function xcodeBuildNumber(version) {
  const [major = '0', minor = '0', patch = '0'] = String(version).split('.');
  return `${major}${minor}${patch}`;
}

const VARIANT_SUFFIX = { development: '.dev', preview: '.preview', production: '' };

/** The bundle id a build of `variant` carries (app-variants-and-environment's variantIdentity). */
export function variantBundleId(appId, variant) {
  return `${appId}${VARIANT_SUFFIX[variant] ?? ''}`;
}

/** A dependency (or devDependency) of any of the package.json objects. */
export function dependsOn(pkgs, name) {
  return pkgs.some((pkg) => pkg?.dependencies?.[name] !== undefined || pkg?.devDependencies?.[name] !== undefined);
}

const SOURCE = /\.[cm]?[jt]sx?$/;
const NOT_APP_CODE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)__tests__\/|\.d\.ts$/;
const SENTINEL_CONST = /\bexport\s+const\s+([A-Z0-9_]*SENTINEL[A-Z0-9_]*)\s*(?::\s*[\w.<>|[\] ]+)?=\s*(['"])([^'"\n]{6,})\2/g;

/** The folders that hold the app source: layout.srcDir, plus <appDir>/src when the app lives in a workspace folder. */
export function appSourceDirs(layout, appDir = '.') {
  const dirs = [layout.srcDir];
  if (appDir !== '.' && appDir !== '') dirs.push(posix.join(appDir, 'src'));
  return [...new Set(dirs)];
}

function appSourceFiles(root, layout, appDir) {
  return walkRepo(root, { include: appSourceDirs(layout, appDir).map((dir) => `${dir}/**`) });
}

/** The app's test-only sentinels: --sentinel values, else rn-skills.config.json testOnlySentinels plus every exported *SENTINEL* constant in the app source. */
export function findSentinels(root, layout, extra = [], appDir = '.') {
  if (extra.length > 0) return [...new Set(extra)].sort();
  const found = new Set();
  const configured = readProjectConfig(root).testOnlySentinels;
  if (Array.isArray(configured)) configured.filter(isText).forEach((value) => found.add(value));
  for (const rel of appSourceFiles(root, layout, appDir).filter((file) => SOURCE.test(file) && !NOT_APP_CODE.test(file))) {
    for (const match of readFileSync(join(root, rel), 'utf8').matchAll(SENTINEL_CONST)) found.add(match[3]);
  }
  return [...found].sort();
}

/** The test-only gate (debug-menu-and-test-hooks): a test-only.ts file in the app source, or null. */
export function findTestOnlyGate(root, layout, appDir = '.') {
  return appSourceFiles(root, layout, appDir).find((rel) => /(?:^|\/)test-only\.[cm]?[jt]sx?$/.test(rel)) ?? null;
}
