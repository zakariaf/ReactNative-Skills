// sdk.mjs: helpers for this skill's checkers. Reads the app repo (one Expo app at the root, or the
// Expo apps and shared packages of npm workspaces), the per-SDK expectations (this skill's
// assets/sdk-lines.json, replaced per SDK by the app's optional contracts/expo-sdk-lines.json), the
// Expo module map, the Xcode the builds use (local lane and EAS images), Android SDK pins and the
// store requirements; compares versions and dates. Not an entry point: nothing runs on import.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lineOf, maskComments, resolveLayout, walkRepo } from '../check-lib.mjs';

export const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const DAY_MS = 86_400_000;

/** rn-skills.config.json keys this skill reads (documented in references/sdk-lines.md). */
export const CONFIG_KEYS = Object.freeze({ sdkLines: 'expoSdkLines', xcodeFile: 'xcodeVersionFile' });
export const SDK_LINES_CONTRACT = 'expo-sdk-lines.json';

const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));

/** Parses a JSON file, or returns { error } so the caller can report it. */
export function readJsonSafe(abs) {
  if (!existsSync(abs)) return { value: null, error: 'missing' };
  try {
    return { value: readJson(abs), error: null };
  } catch (error) {
    return { value: null, error: `not valid JSON (${String(error.message).split('\n')[0]})` };
  }
}

// ---------------------------------------------------------------------------------------------
// Versions and dates
// ---------------------------------------------------------------------------------------------

/** "~57.0.25" -> "57.0.25"; "^1.2.3" -> "1.2.3". */
export const bare = (spec) => String(spec ?? '').replace(/^[~^=v]+/, '').trim();
export const majorOf = (spec) => Number(bare(spec).split('.')[0]);

/** Numeric compare of two versions (a prerelease sorts before its release). */
export function compareVersions(a, b) {
  const [coreA, preA] = bare(a).split('-');
  const [coreB, preB] = bare(b).split('-');
  const partsA = coreA.split('.').map(Number);
  const partsB = coreB.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (preA === undefined && preB === undefined) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : preA > preB ? 1 : 0;
}

/** True when a concrete version satisfies "x.y.z", "~x.y.z" or "^x.y.z" (enough for Expo's map). */
export function satisfies(version, spec) {
  const want = bare(spec);
  const [major, minor] = want.split('.').map(Number);
  const got = bare(version);
  const [gotMajor, gotMinor] = got.split('.').map(Number);
  if (String(spec).startsWith('~')) return gotMajor === major && gotMinor === minor && compareVersions(got, want) >= 0;
  if (String(spec).startsWith('^')) return gotMajor === major && compareVersions(got, want) >= 0;
  return got === want;
}

/** True when a version starts with a line such as "19.3" or "30". */
export const onLine = (version, line) => bare(version) === line || bare(version).startsWith(`${line}.`);

/** -1 when a version is below a line ("29.7.0" vs "30"), 1 when above, 0 on it. */
export function lineOrder(version, line) {
  if (onLine(version, line)) return 0;
  const parts = String(line).split('.').length;
  const head = bare(version).split('.').slice(0, parts).join('.');
  return compareVersions(head, line) < 0 ? -1 : 1;
}

// Release age: measured from a moment, as npm measures it at install time (`min-release-age=<days>`
// refuses every version published less than <days> * 24 hours before the install), never from the
// start of a day. A day-precision check would either call a move due hours before npm accepts it or
// wait a whole extra day.

/** The policy floor (dependency-management owns the policy); an app's .npmrc may only be stricter. */
export const RELEASE_AGE_MIN_DAYS = 7;
const MINUTE_MS = 60_000;

/** True when the release is at least `days` days old at the moment `nowMs`. */
export const isOldEnough = (publishedIso, nowMs, days) => nowMs - Date.parse(publishedIso) >= days * DAY_MS;

/**
 * The moment (ISO, to the minute) a release turns `days` days old: npm accepts it from then on.
 * Rounded up to the next whole minute, so the printed moment is never earlier than the real one
 * (published 18:00:30 prints 18:01, when npm would still refuse it at 18:00).
 */
export function oldEnoughAt(publishedIso, days) {
  const atMs = Date.parse(publishedIso) + days * DAY_MS;
  return `${new Date(Math.ceil(atMs / MINUTE_MS) * MINUTE_MS).toISOString().slice(0, 16)}Z`;
}

/** A moment as ISO to the minute, as the wait lines print it (rounded down: the moment has begun). */
export const minuteOf = (nowMs) => `${new Date(nowMs).toISOString().slice(0, 16)}Z`;

/** A publish time as ISO to the minute (rounded down, as it is printed next to the age). */
export const publishedMinute = (iso) => minuteOf(Date.parse(iso));

/**
 * One .npmrc value the way npm's ini parser reads it: trimmed, one pair of matching quotes removed,
 * an unescaped "#" or ";" starts a comment. The same reading as dependency-management's policy.
 */
function iniValue(raw) {
  const text = String(raw ?? '').trim();
  const quote = text.charAt(0);
  if (text.length >= 2 && (quote === '"' || quote === "'") && text.endsWith(quote)) return text.slice(1, -1);
  let out = '';
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === ';' || ch === '#') break;
    else if (ch === '\\') escaped = true;
    else out += ch;
  }
  return out.trim();
}

/**
 * The release age npm applies for this repo: the last acceptable `min-release-age` line of the
 * repo's .npmrc (a number of days at or above the 7-day floor; npm keeps the last value of a key),
 * else the floor. A stricter app (min-release-age=14) waits 14 days for an SDK too: an earlier
 * "upgrade-due" would end in npm's ETARGET at the first install of the move.
 */
export function releaseAgeDays(npmrcText) {
  let days = RELEASE_AGE_MIN_DAYS;
  for (const raw of String(npmrcText ?? '').split(/\r?\n/)) {
    if (/^\s*([;#]|$)/.test(raw) || /^\s*\[[^\]]*\]\s*$/.test(raw)) continue;
    const at = raw.indexOf('=');
    if (at < 0 || iniValue(raw.slice(0, at)) !== 'min-release-age') continue;
    const value = iniValue(raw.slice(at + 1));
    if (value !== '' && Number.isFinite(Number(value)) && Number(value) >= RELEASE_AGE_MIN_DAYS) days = Number(value);
  }
  return days;
}

/** The repo's release age: { days, source } read from <root>/.npmrc. */
export function repoReleaseAge(root) {
  const file = join(root, '.npmrc');
  if (!existsSync(file)) return { days: RELEASE_AGE_MIN_DAYS, source: `no .npmrc: the ${RELEASE_AGE_MIN_DAYS}-day floor` };
  const days = releaseAgeDays(readFileSync(file, 'utf8'));
  return { days, source: days === RELEASE_AGE_MIN_DAYS ? `.npmrc: the ${RELEASE_AGE_MIN_DAYS}-day floor` : '.npmrc min-release-age' };
}

/**
 * The npm arguments that read the target expo's tarball (its bundledNativeModules.json) for the
 * trigger. `--min-release-age=0`: reading a JSON file from a release is not adopting it, and the
 * repo's own policy would refuse exactly the young release whose age the trigger reports (ETARGET
 * instead of a "wait [target-age]" line). Run it with the temporary folder as the working directory
 * so the project's .npmrc does not apply either.
 */
export function npmPackArgs(version, destination) {
  return ['pack', `expo@${version}`, '--pack-destination', destination, '--min-release-age=0', '--silent'];
}

// ---------------------------------------------------------------------------------------------
// SDK lines: this skill's table, replaced per SDK by the app's contracts/expo-sdk-lines.json
// ---------------------------------------------------------------------------------------------

const LINE_STRINGS = ['status', 'expo', 'reactNative', 'react', 'typesReact', 'testRenderer', 'typescript', 'jest', 'typesJest', 'skiaPostinstallUntil', 'xcodeMin'];
const LINE_NULLABLE = ['xcodeMaxWithoutSceneSupport', 'sceneSupportMinExpo'];
const LINE_ARRAYS = ['jestConfigMustInclude', 'removedApis', 'removedAppConfigKeys'];
const LINE_OPTIONAL = ['ios', 'eas', 'xcodeMax', 'minExpo', 'skipFrom', 'advisory'];
const LINE_KEYS = new Set([...LINE_STRINGS, ...LINE_NULLABLE, ...LINE_ARRAYS, ...LINE_OPTIONAL, 'gestureHandlerMajor', 'configPluginsImport', 'android']);
const VERSION = /^\d+(\.\d+){0,2}$/;
const API_KEYS = ['id', 'rule', 'scope', 'from', 'pattern', 'fix'];

function validRegex(source) {
  try {
    new RegExp(source, 'g');
    return true;
  } catch {
    return false;
  }
}

/** The shape problems of one SDK entry (assets/sdk-lines.schema.json, checked by code). */
export function validateLine(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return ['is not an object'];
  const problems = [];
  for (const key of Object.keys(entry)) if (!key.startsWith('$') && !LINE_KEYS.has(key)) problems.push(`"${key}" is not a key of an SDK entry`);
  for (const key of LINE_STRINGS) if (typeof entry[key] !== 'string' || entry[key].trim() === '') problems.push(`"${key}" must be a non-empty string`);
  for (const key of LINE_NULLABLE) if (!(key in entry) || (entry[key] !== null && typeof entry[key] !== 'string')) problems.push(`"${key}" must be a string or null`);
  for (const key of LINE_ARRAYS) if (!Array.isArray(entry[key])) problems.push(`"${key}" must be a list`);
  if (!Number.isInteger(entry.gestureHandlerMajor)) problems.push('"gestureHandlerMajor" must be an integer');
  if (!['expo/config-plugins.js', 'expo/config-plugins'].includes(entry.configPluginsImport)) problems.push('"configPluginsImport" must be "expo/config-plugins.js" or "expo/config-plugins"');
  const android = entry.android;
  if (android === null || typeof android !== 'object') problems.push('"android" must be an object with compileSdk, targetSdk and minSdk');
  else for (const key of ['compileSdk', 'targetSdk', 'minSdk']) if (!Number.isInteger(android[key])) problems.push(`"android.${key}" must be an integer`);
  for (const [index, item] of (Array.isArray(entry.jestConfigMustInclude) ? entry.jestConfigMustInclude : []).entries()) {
    for (const key of ['text', 'pattern', 'why', 'fix']) if (typeof item?.[key] !== 'string') problems.push(`"jestConfigMustInclude[${index}].${key}" must be a string`);
    if (typeof item?.pattern === 'string' && !validRegex(item.pattern)) problems.push(`"jestConfigMustInclude[${index}].pattern" is not a valid regular expression`);
  }
  if ('ios' in entry && (entry.ios === null || typeof entry.ios !== 'object' || (entry.ios.deploymentTarget !== undefined && !VERSION.test(String(entry.ios.deploymentTarget))))) problems.push('"ios" must be an object whose "deploymentTarget" is a version such as "16.4"');
  if ('xcodeMax' in entry && entry.xcodeMax !== null && !(typeof entry.xcodeMax === 'string' && VERSION.test(entry.xcodeMax))) problems.push('"xcodeMax" must be an Xcode major such as "26", or null');
  if ('minExpo' in entry && !(typeof entry.minExpo === 'string' && /^\d+\.\d+\.\d+$/.test(entry.minExpo))) problems.push('"minExpo" must be an exact expo version such as "57.0.9"');
  if ('skipFrom' in entry && !(Array.isArray(entry.skipFrom) && entry.skipFrom.every(Number.isInteger))) problems.push('"skipFrom" must be a list of SDK majors');
  if ('advisory' in entry && typeof entry.advisory !== 'string') problems.push('"advisory" must be a string');
  for (const [index, item] of (Array.isArray(entry.removedApis) ? entry.removedApis : []).entries()) {
    for (const key of API_KEYS) if (typeof item?.[key] !== 'string') problems.push(`"removedApis[${index}].${key}" must be a string`);
    if (item && !['removed-rn-api', 'removed-test-api'].includes(item.rule)) problems.push(`"removedApis[${index}].rule" must be removed-rn-api or removed-test-api`);
    if (item && !['app', 'test'].includes(item.scope)) problems.push(`"removedApis[${index}].scope" must be app or test`);
    if (typeof item?.pattern === 'string' && !validRegex(item.pattern)) problems.push(`"removedApis[${index}].pattern" is not a valid regular expression`);
  }
  for (const [index, item] of (Array.isArray(entry.removedAppConfigKeys) ? entry.removedAppConfigKeys : []).entries()) {
    for (const key of ['key', 'pattern', 'fix']) if (typeof item?.[key] !== 'string') problems.push(`"removedAppConfigKeys[${index}].${key}" must be a string`);
    if (typeof item?.pattern === 'string' && !validRegex(item.pattern)) problems.push(`"removedAppConfigKeys[${index}].pattern" is not a valid regular expression`);
  }
  return problems;
}

/** Where the app keeps its own SDK lines: --sdk-lines, else rn-skills.config.json, else contracts/. */
export function sdkLinesContractPath(layout, option) {
  if (option) return option;
  const configured = layout.config?.[CONFIG_KEYS.sdkLines];
  if (typeof configured === 'string' && configured.trim() !== '') return configured;
  return `${layout.contractsDir}/${SDK_LINES_CONTRACT}`;
}

/**
 * The per-SDK expectations: this skill's table, with every valid entry of the app's contract
 * replacing the skill's entry for that SDK. Returns { lines, fromRepo: Set<sdk>, contract, problems }.
 */
export function loadSdkLines(root, layout, option) {
  const lines = { ...readJson(join(ASSETS, 'sdk-lines.json')).sdks };
  const contract = sdkLinesContractPath(layout, option);
  const fromRepo = new Set();
  const problems = [];
  const abs = resolve(root, contract);
  if (!existsSync(abs)) {
    if (option) problems.push({ file: contract, line: 0, message: 'does not exist (passed with --sdk-lines)' });
    return { lines, fromRepo, contract, problems };
  }
  const text = readFileSync(abs, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    problems.push({ file: contract, line: 1, message: `is not valid JSON (${String(error.message).split('\n')[0]})` });
    return { lines, fromRepo, contract, problems };
  }
  if (data === null || typeof data !== 'object' || typeof data.sdks !== 'object' || data.sdks === null || Array.isArray(data.sdks)) {
    problems.push({ file: contract, line: 1, message: 'has no "sdks" object' });
    return { lines, fromRepo, contract, problems };
  }
  for (const [sdk, entry] of Object.entries(data.sdks)) {
    const at = text.indexOf(`"${sdk}"`);
    const line = at < 0 ? 1 : lineOf(text, at);
    if (!/^[1-9]\d*$/.test(sdk)) {
      problems.push({ file: contract, line, message: `key "${sdk}" is not an SDK major` });
      continue;
    }
    const shape = validateLine(entry);
    if (shape.length > 0) problems.push({ file: contract, line, message: `SDK ${sdk}: ${shape.join('; ')}` });
    else {
      lines[sdk] = entry;
      fromRepo.add(sdk);
    }
  }
  return { lines, fromRepo, contract, problems };
}

/**
 * The SDK an app on `sdk` moves to next: one SDK at a time (sdk + 1), unless a later SDK's entry
 * lists `sdk` in "skipFrom" (Expo's release notes tell apps on that SDK to go straight to it: from
 * SDK 55 to 57, past 56's Hermes V1 memory regression). Returns { target, skipped: [...], line }.
 */
export function recommendedTarget(sdk, lines) {
  const later = Object.keys(lines).map(Number).filter((major) => major > sdk + 1 && (lines[String(major)]?.skipFrom ?? []).includes(sdk)).sort((a, b) => a - b);
  if (later.length === 0) return { target: sdk + 1, skipped: [], line: lines[String(sdk + 1)] ?? null };
  const target = later[0];
  return { target, skipped: Array.from({ length: target - sdk - 1 }, (_, index) => sdk + 1 + index), line: lines[String(target)] };
}

/** Store requirements (assets/store-requirements.json). */
export function loadStoreRequirements() {
  return readJson(join(ASSETS, 'store-requirements.json'));
}

// ---------------------------------------------------------------------------------------------
// The app repo
// ---------------------------------------------------------------------------------------------

/** Name -> spec for dependencies and devDependencies of one manifest. */
export const depsOf = (manifest) => ({ ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) });

/** The manifest file of a workspace folder ('' is the root). */
export const manifestFile = (ws) => (ws === '' ? 'package.json' : `${ws}/package.json`);

/**
 * Everything the checks read from the repo. A single app is the root itself; with package.json
 * "workspaces", the apps are the workspaces whose dependencies hold expo and the rest are shared
 * packages. Each entry: { ws, file, manifest, layout }.
 */
export function readRepo(root) {
  const layout = resolveLayout(root);
  const errors = [];
  const load = (rel) => {
    const result = readJsonSafe(join(root, rel));
    if (result.error && result.error !== 'missing') errors.push({ file: rel, message: result.error });
    return result.value;
  };
  const rootManifest = load('package.json');
  const workspaces = layout.workspaces
    .map((workspace) => ({ ws: workspace.dir, file: manifestFile(workspace.dir), layout: workspace.layout, manifest: load(manifestFile(workspace.dir)) }))
    .filter((workspace) => workspace.manifest !== null);
  const apps = layout.mode === 'single' ? (rootManifest ? [{ ws: '', file: 'package.json', layout, manifest: rootManifest }] : []) : workspaces.filter((workspace) => workspace.manifest.dependencies?.expo !== undefined);
  const shared = layout.mode === 'single' ? [] : workspaces.filter((workspace) => workspace.manifest.dependencies?.expo === undefined);
  const lock = readJsonSafe(join(root, 'package-lock.json'));
  if (lock.error && lock.error !== 'missing') errors.push({ file: 'package-lock.json', message: lock.error });
  return { root, layout, mode: layout.mode, rootManifest, apps, shared, errors, lockfile: lock.value };
}

/** The Expo SDK major the apps declare (first app with an "expo" dependency), or null. */
export function appsSdk(repo) {
  for (const app of repo.apps) {
    const spec = app.manifest.dependencies?.expo;
    if (spec) return majorOf(spec);
  }
  return null;
}

const withoutMeta = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => !key.startsWith('$')));

/**
 * The expo version the apps install: package-lock.json's copy for the root or the first app
 * (`node_modules/expo`, `<app>/node_modules/expo`), else the floor of the declared specifier.
 * Returns { version, file } or null without an expo dependency.
 */
export function installedExpo(repo) {
  const app = repo.apps.find((entry) => entry.manifest.dependencies?.expo);
  if (!app) return null;
  const packages = repo.lockfile?.packages ?? {};
  for (const path of [app.ws ? `${app.ws}/node_modules/expo` : null, 'node_modules/expo'].filter(Boolean)) {
    const version = packages[path]?.version;
    if (typeof version === 'string') return { version, file: 'package-lock.json', declared: app.manifest.dependencies.expo };
  }
  return { version: bare(app.manifest.dependencies.expo), file: app.file, declared: app.manifest.dependencies.expo };
}

/**
 * The module map `npx expo install` applies for an SDK: the installed expo's
 * bundledNativeModules.json (root or an app) when it is on that SDK, else this skill's copy. A
 * pre-release copy (`expo-sdk-<n>-next-module-map.json`, its "$expo" key naming the expo it was read
 * from) counts only for an app on exactly that expo: once the SDK is stable, a later expo installs
 * other versions (react-native 0.88.0 for 0.88.0-rc.3), and comparing against the old map would
 * print false module-map failures. Returns { map, source, note }.
 */
export function moduleMapFor(repo, sdk) {
  for (const base of ['', ...repo.apps.map((app) => app.ws).filter(Boolean)]) {
    const installed = join(repo.root, base, 'node_modules', 'expo');
    if (!existsSync(join(installed, 'bundledNativeModules.json'))) continue;
    const version = readJsonSafe(join(installed, 'package.json')).value?.version;
    if (version && majorOf(version) === sdk) return { map: withoutMeta(readJson(join(installed, 'bundledNativeModules.json'))), source: `${base ? `${base}/` : ''}node_modules/expo (expo ${version})`, note: null };
  }
  const stable = `expo-sdk-${sdk}-module-map.json`;
  if (existsSync(join(ASSETS, stable))) return { map: withoutMeta(readJson(join(ASSETS, stable))), source: `the skill's ${stable}`, note: null };
  const next = `expo-sdk-${sdk}-next-module-map.json`;
  if (existsSync(join(ASSETS, next))) {
    const data = readJson(join(ASSETS, next));
    const app = installedExpo(repo);
    if (typeof data.$expo === 'string' && app && app.version !== data.$expo) {
      return { map: null, source: null, note: `the skill's ${next} was read from the pre-release expo ${data.$expo}, but the app installs expo ${app.version} (${app.file}): module-map and duplicate-native are skipped; run npm ci so node_modules/expo/bundledNativeModules.json exists, or refresh the skill` };
    }
    return { map: withoutMeta(data), source: `the skill's ${next}`, note: null };
  }
  return { map: null, source: null, note: null };
}

// ---------------------------------------------------------------------------------------------
// Files: app code (src, test, mocks, entry) and Node code (app config, plugins, scripts)
// ---------------------------------------------------------------------------------------------

const CODE_FILES = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'];
const APP_CONFIG = /^app\.config\.(ts|js|mjs|cjs)$/;
const ENTRY = /^(index|App)\.(ts|tsx|js|jsx)$/;
export const isTestPath = (rel) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)__tests__\//.test(rel);

/**
 * The repo's code files, classified: `app` (each app's and package's src, test and __mocks__
 * folders and root entry files), `node` (app.config.*, plugins/, scripts/), `config` (the app
 * config files themselves, app.json included), `tests` (test files in either). Installed skills,
 * generated native folders and build output are never read (walkRepo).
 */
export function repoFiles(repo) {
  const owners = [{ prefix: '', layout: repo.layout }, ...repo.layout.workspaces.map((workspace) => ({ prefix: workspace.dir, layout: workspace.layout }))];
  const app = [];
  const node = [];
  const config = [];
  const under = (rel, dir) => dir !== '' && (rel === dir || rel.startsWith(`${dir}/`));
  for (const rel of walkRepo(repo.root, { include: CODE_FILES, ignore: ['*.d.ts'] })) {
    const owner = owners.filter((entry) => entry.prefix === '' || rel.startsWith(`${entry.prefix}/`)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    const local = owner.prefix ? rel.slice(owner.prefix.length + 1) : rel;
    const { layout } = owner;
    if (under(rel, layout.srcDir) || under(rel, layout.testDir) || under(rel, layout.mocksDir) || ENTRY.test(local)) app.push(rel);
    else if (APP_CONFIG.test(local)) {
      node.push(rel);
      config.push(rel);
    } else if (local.startsWith('plugins/') || under(rel, layout.scriptsDir)) node.push(rel);
  }
  for (const owner of owners) {
    const json = owner.prefix ? `${owner.prefix}/app.json` : 'app.json';
    if (existsSync(join(repo.root, json))) config.push(json);
  }
  const tests = [...app, ...node].filter((rel) => isTestPath(rel) || owners.some((owner) => under(rel, owner.layout.testDir)));
  return { app: app.sort(), node: node.sort(), config: config.sort(), tests: tests.sort() };
}

const cache = new Map();
/** A file's text with comments masked (strings kept), cached per run. */
export function maskedText(root, rel) {
  const key = join(root, rel);
  if (!cache.has(key)) cache.set(key, maskComments(readFileSync(key, 'utf8')));
  return cache.get(key);
}

// ---------------------------------------------------------------------------------------------
// eas.json: build profiles and their images
// ---------------------------------------------------------------------------------------------

/**
 * One eas.json's build profiles with their iOS and Android image (inherited through "extends"), each
 * with the line it is written on. Returns { file, exists, error, profiles: [{ name, ios, android }] }
 * where a platform is { image, line } or null.
 */
export function readEas(root, file = 'eas.json') {
  const abs = join(root, file);
  if (!existsSync(abs)) return { file, exists: false, error: null, profiles: [] };
  const text = readFileSync(abs, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { file, exists: true, error: `not valid JSON (${String(error.message).split('\n')[0]})`, profiles: [] };
  }
  const build = data?.build && typeof data.build === 'object' ? data.build : {};
  const lineOfImage = (name, platform) => {
    const start = text.indexOf(`"${name}"`);
    if (start < 0) return 1;
    const platformAt = text.indexOf(`"${platform}"`, start);
    const imageAt = platformAt < 0 ? -1 : text.indexOf('"image"', platformAt);
    return lineOf(text, imageAt < 0 ? start : imageAt);
  };
  const resolvePlatform = (name, platform, seen = new Set()) => {
    const profile = build[name];
    if (!profile || seen.has(name)) return null;
    seen.add(name);
    const image = profile?.[platform]?.image;
    if (typeof image === 'string') return { image, line: lineOfImage(name, platform), from: name };
    return typeof profile.extends === 'string' ? resolvePlatform(profile.extends, platform, seen) : null;
  };
  const profiles = Object.keys(build).map((name) => ({ name, ios: resolvePlatform(name, 'ios'), android: resolvePlatform(name, 'android') }));
  return { file, exists: true, error: null, profiles };
}

/** The eas.json files of the repo: the root one, and each app's when multi-package (EAS projects are per app). */
export function easFiles(repo) {
  const files = repo.mode === 'single' ? ['eas.json'] : [...repo.apps.map((app) => `${app.ws}/eas.json`), 'eas.json'];
  return [...new Set(files)].map((file) => readEas(repo.root, file));
}

export const EAS_FLOATING = new Set(['latest']);
export const EAS_AUTO = new Set(['auto', 'default']);

// ---------------------------------------------------------------------------------------------
// The Xcode the builds use
// ---------------------------------------------------------------------------------------------

const XCODE_CONSTANT = /XCODE_VERSION\s*[:=]\s*['"](\d+(?:\.\d+)*)['"]/;
const BARE_VERSION = /^\s*(\d+(?:\.\d+)*)\s*$/m;

function versionInFile(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, 'utf8');
  const constant = XCODE_CONSTANT.exec(text);
  if (constant) return { version: constant[1], line: lineOf(text, constant.index) };
  const plain = BARE_VERSION.exec(text);
  return plain ? { version: plain[1], line: lineOf(text, plain.index) } : null;
}

/**
 * Every place that decides which Xcode builds the app: --xcode; the file rn-skills.config.json
 * names (xcodeVersionFile); .xcode-version; a toolchain module that exports XCODE_VERSION (the
 * local build lane); and each eas.json profile whose ios.image names an exact image. Returns
 * { sources: [{ version, file, line, label }], eas: [readEas results], easAuto: [profile labels] }.
 */
export function xcodeSources(repo, files, option) {
  const eas = easFiles(repo);
  if (option) return { sources: [{ version: option, file: '--xcode', line: 0, label: '--xcode' }], eas, easAuto: [] };
  const sources = [];
  const configured = repo.layout.config?.[CONFIG_KEYS.xcodeFile];
  for (const rel of [...(typeof configured === 'string' ? [configured] : []), '.xcode-version']) {
    const found = versionInFile(repo.root, rel);
    if (found && !sources.some((source) => source.file === rel)) sources.push({ ...found, file: rel, label: rel });
  }
  for (const rel of files.node.concat(files.app).filter((file) => /^toolchain\.(ts|mjs|js|cjs)$/.test(basename(file)))) {
    const text = readFileSync(join(repo.root, rel), 'utf8');
    const constant = XCODE_CONSTANT.exec(text);
    if (constant) sources.push({ version: constant[1], file: rel, line: lineOf(text, constant.index), label: rel });
  }
  const easAuto = [];
  for (const easFile of eas) {
    for (const profile of easFile.profiles) {
      const image = profile.ios?.image;
      if (!image || EAS_AUTO.has(image)) easAuto.push(`${easFile.file} ${profile.name}`);
      const exact = image ? /xcode-(\d+(?:\.\d+)*)/.exec(image) : null;
      if (exact) sources.push({ version: exact[1], file: easFile.file, line: profile.ios.line, label: `${easFile.file} build.${profile.name}.ios.image ${image}` });
    }
  }
  return { sources, eas, easAuto };
}

// ---------------------------------------------------------------------------------------------
// App config facts: Android SDK pins, scene support
// ---------------------------------------------------------------------------------------------

const ANDROID_PIN = /\b(compileSdkVersion|targetSdkVersion|minSdkVersion)\b['"]?\s*:\s*(\d+)/g;

/** expo-build-properties Android SDK levels written in the app config, plugins or config helpers. */
export function androidPins(repo, files) {
  const pins = [];
  for (const rel of [...new Set([...files.config, ...files.node])]) {
    if (isTestPath(rel)) continue;
    const text = maskedText(repo.root, rel);
    for (const match of text.matchAll(ANDROID_PIN)) pins.push({ key: match[1], value: Number(match[2]), file: rel, line: lineOf(text, match.index) });
  }
  return pins;
}

/** The Android targetSdk the app ships: a targetSdkVersion pin, else the SDK line's default. */
export function androidTarget(pins, line) {
  const pin = pins.find((entry) => entry.key === 'targetSdkVersion');
  if (pin) return { value: pin.value, file: pin.file, line: pin.line, label: `targetSdkVersion in ${pin.file}` };
  return line?.android ? { value: line.android.targetSdk, file: 'package.json', line: 1, label: 'the SDK default' } : null;
}

const IOS_DEPLOYMENT_TARGET = /\bdeploymentTarget\b['"]?\s*:\s*['"](\d+(?:\.\d+)*)['"]/g;

/** expo-build-properties ios.deploymentTarget values written in the app config, plugins or config helpers. */
export function iosPins(repo, files) {
  const pins = [];
  for (const rel of [...new Set([...files.config, ...files.node])]) {
    if (isTestPath(rel)) continue;
    const text = maskedText(repo.root, rel);
    for (const match of text.matchAll(IOS_DEPLOYMENT_TARGET)) pins.push({ value: match[1], file: rel, line: lineOf(text, match.index) });
  }
  return pins;
}

const SCENE_ON = /enableSceneSupport['"]?\s*:\s*true/;
const SCENE_CALLS = /\b(?:add|with)SceneSupport\s*\(/g;
const SCENE_DEFINITION = /\bfunction\s+((?:add|with)SceneSupport)\s*\(/;

/**
 * Where scene support is switched on: a config file that sets enableSceneSupport: true itself, or
 * that calls the helper (templates/scripts/config/scene-support.ts). The helper file and tests only
 * define it, so they count as on only through a call; once the SDK handles scenes they are leftovers.
 */
export function sceneSupport(repo, files) {
  const active = [];
  const leftovers = [];
  for (const rel of [...new Set([...files.config, ...files.node])]) {
    const text = maskedText(repo.root, rel);
    const definition = SCENE_DEFINITION.exec(text);
    const definedAt = definition ? definition.index + definition[0].indexOf(definition[1]) : -1;
    const call = [...text.matchAll(SCENE_CALLS)].find((match) => match.index !== definedAt);
    const hit = (definition ? null : SCENE_ON.exec(text)) ?? call;
    const isTest = isTestPath(rel);
    if (hit && !isTest) active.push({ rel, line: lineOf(text, hit.index) });
    else if (definition || (isTest && (hit || SCENE_ON.test(text)))) leftovers.push({ rel, line: lineOf(text, (definition ?? hit ?? SCENE_ON.exec(text)).index) });
  }
  return { active, leftovers };
}
