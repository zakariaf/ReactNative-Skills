// policy.mjs: reads the app's dependency policy (contracts/dependency-policy.json), this skill's ban
// lists and Expo module map, and the manifests, lockfile and .npmrc of an app repo (one app at the
// root, or npm workspaces). Shared by check-deps-policy.mjs and plan-dependency.mjs. Not an entry
// point: no side effects on import.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorkspaces, toPosix } from '../check-lib.mjs';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

/** The contract file name inside the layout's contractsDir, and its rn-skills.config.json key. */
export const POLICY_FILE = 'dependency-policy.json';
export const POLICY_CONFIG_KEY = 'dependencyPolicy';
/** What the expo package's bundledNativeModules.json in assets/ was copied from. */
export const MODULE_MAP_SOURCE = { sdk: 57, expo: '57.0.26' };

export const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const DEFAULT_LICENSES = Object.freeze(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'OFL-1.1', 'CC0-1.0']);
export const SECTIONS = Object.freeze(['dependencies', 'devDependencies', 'optionalDependencies']);
const WHERE_KEYWORDS = new Set(['app', 'dev']);
/** The floor of the release-age policy, in days; an app may set a stricter min-release-age. */
export const RELEASE_AGE_MIN_DAYS = 7;

/** The keys the contract knows, per object; anything else is a typo that would switch a guard off. */
const KNOWN_KEYS = Object.freeze({
  policy: ['$comment', 'sdk', 'verified', 'profiles', 'packages', 'heldBack', 'doNotAdd', 'banned', 'licenses'],
  row: ['$comment', 'version', 'spec', 'install', 'where', 'why', 'native', 'implicitUse', 'companions', 'deprecated', 'override'],
  companion: ['$comment', 'package', 'version', 'via', 'why'],
  heldBack: ['$comment', 'package', 'allowed', 'trigger'],
  banned: ['$comment', 'pattern', 'scope', 'reason', 'useInstead', 'source'],
  doNotAdd: ['$comment', 'reason', 'where', 'allowIn'],
  licenses: ['$comment', 'allowed', 'exceptions'],
  exception: ['$comment', 'license', 'reason'],
});

const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));

function readJsonIfPresent(abs) {
  if (!existsSync(abs)) return { ok: false, error: 'missing' };
  try {
    return { ok: true, value: readJson(abs) };
  } catch (error) {
    return { ok: false, error: `not valid JSON (${error.message.split('\n')[0]})` };
  }
}

/** "~57.0.25" -> "57.0.25"; "^1.2.3" -> "1.2.3". */
export const bareVersion = (spec) => String(spec).replace(/^[~^=v]+/, '');
export const majorOf = (spec) => Number(bareVersion(spec).split('.')[0]);

/** A row's places: "where" is one place ("app", "dev" or a workspace folder) or a list of them. */
export const placesOf = (row) => (Array.isArray(row?.where) ? row.where : typeof row?.where === 'string' ? [row.where] : []);
/** True when a row may sit in the apps' runtime dependencies. */
export const isAppRow = (row) => placesOf(row).includes('app');
/** True when every place of a row is the dev tools (nothing of it ships). */
export const isDevRow = (row) => placesOf(row).length > 0 && placesOf(row).every((place) => place === 'dev');

/**
 * A doNotAdd entry in one shape: a string keeps the package out of every place and out of every file
 * ({ reason, where: null, allowIn: [] }); the object form keeps it out of its "where" places only and
 * lets the files its "allowIn" globs match import it (the JS SDK kept out of the app while a dev row
 * allows it for the rules tests under test/rules/). null when the policy has no entry.
 */
export function doNotAddEntry(policy, name) {
  const entry = policy?.doNotAdd?.[name];
  if (entry === undefined || entry === null) return null;
  if (typeof entry === 'string') return { reason: entry, where: null, allowIn: [] };
  return { reason: String(entry.reason ?? ''), where: placesOf(entry), allowIn: Array.isArray(entry.allowIn) ? entry.allowIn : [] };
}

/** True when a doNotAdd entry (doNotAddEntry) keeps its package out of `place` ("app", "dev", a workspace folder). */
export const doNotAddBlocks = (entry, place) => entry !== null && (entry.where === null || entry.where.includes(place));

/** True when a specifier (exact, ~x.y.z or ^x.y.z) accepts an exact version. */
export function specAccepts(spec, version) {
  const text = String(spec);
  const [a, b, c] = bareVersion(text).split('-')[0].split('.').map(Number);
  const [x, y, z] = String(version).split('-')[0].split('.').map(Number);
  if (text.startsWith('~')) return x === a && y === b && z >= c;
  if (text.startsWith('^')) return a > 0 ? x === a && (y > b || (y === b && z >= c)) : x === 0 && y === b && z >= c;
  return bareVersion(text) === String(version);
}

/** The supply-chain floor and the opt-in profiles, each entry with its compiled regex. */
export function loadBanLists() {
  const raw = readJson(join(ASSETS, 'banned-packages.json'));
  const compile = (entry) => ({ ...entry, regex: new RegExp(entry.pattern) });
  return {
    supplyChain: raw.supplyChain.map(compile),
    profiles: Object.fromEntries(Object.entries(raw.profiles).map(([name, list]) => [name, list.map(compile)])),
  };
}

/** The fix sentence for a ban: what to use instead, when the entry names something. */
export const banFix = (ban) => (ban?.useInstead ? ` Instead: ${ban.useInstead}.` : '');

const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const SEMVER_EXACT = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * One allowScripts key as npm 11.17 matches it (arborist script-allowed.js): { kind: 'any', name }
 * for "name" or "name@*", { kind: 'versions', name, versions } for "name@x.y.z" or
 * "name@x.y.z || a.b.c", else { kind: 'unsupported', name (or null), why }: ranges and tags never
 * match in npm, and git, file, URL and alias keys match a resolved source this check cannot see.
 */
export function parseAllowScriptsKey(key) {
  const match = /^(@[^@/\s]+\/[^@\s]+|[^@\s]+)(?:@(.*))?$/.exec(String(key).trim());
  if (!match || !NPM_NAME.test(match[1])) return { kind: 'unsupported', name: null, why: 'not a registry package name; git, file and URL keys match a resolved source this check cannot see' };
  const [, name, spec] = match;
  if (spec === undefined || spec.trim() === '' || spec.trim() === '*') return { kind: 'any', name };
  const versions = spec.split('||').map((part) => part.trim());
  if (versions.every((version) => SEMVER_EXACT.test(version))) return { kind: 'versions', name, versions: versions.map((version) => version.replace(/^v/, '')) };
  return { kind: 'unsupported', name, why: `"${spec.trim()}" is neither an exact version nor exact versions joined by ||, and npm never matches a range or a tag` };
}

/**
 * True when an SPDX expression is acceptable: an OR needs one allowed side, an AND needs both. AND
 * binds tighter than OR and parentheses group, as SPDX defines (the same parser as the app's
 * scripts/audit/license-policy.ts); a malformed expression is never allowed. So
 * "(MIT OR GPL-3.0-only) AND LGPL-3.0-only" is refused: LGPL is required whichever side is chosen.
 */
export function isAllowedLicense(expression, allowed = DEFAULT_LICENSES) {
  const tokens = String(expression ?? '').replace(/[()]/g, ' $& ').trim().split(/\s+/);
  let next = 0;
  const parseTerm = () => {
    const token = tokens[next++];
    if (token === '(') {
      const inner = parseOr();
      return tokens[next++] === ')' ? inner : null;
    }
    if (token === undefined || token === '' || token === ')' || token === 'AND' || token === 'OR') return null;
    return allowed.includes(token);
  };
  const parseAnd = () => {
    let ok = parseTerm();
    while (ok !== null && tokens[next] === 'AND') {
      next += 1;
      const right = parseTerm();
      ok = right === null ? null : ok && right;
    }
    return ok;
  };
  const parseOr = () => {
    let ok = parseAnd();
    while (ok !== null && tokens[next] === 'OR') {
      next += 1;
      const right = parseAnd();
      ok = right === null ? null : ok || right;
    }
    return ok;
  };
  return parseOr() === true && next === tokens.length;
}

// ---------------------------------------------------------------------------------------------
// Versions and ranges (engines)
// ---------------------------------------------------------------------------------------------

/**
 * The floors package.json "engines" must hold so that engine-strict=true keeps an old toolchain
 * out. npm 10 (the EAS default) has none of the policy settings; min-release-age arrived in npm
 * 11.10.0, allowScripts and strict-allow-scripts in 11.16.0, and min-release-age-exclude (the dated
 * blocks) in 11.17.0 (verified 2026-10-03 in the published npm tarballs), so 11.17.0 is the floor.
 * Node 22.18 runs the gate scripts by type stripping.
 */
export const ENGINE_FLOORS = Object.freeze({ npm: '11.17.0', node: '22.18.0' });
/** The "engines" ranges the fix lines write (the same as the canonical root package.json). */
export const ENGINE_RANGES = Object.freeze({ npm: '>=11.17.0', node: '>=22.18' });

/** [major, minor, patch, prerelease] of a version or a partial ("11", "11.17", "11.x"), missing parts 0. */
function versionParts(text) {
  const [core, pre = ''] = String(text).replace(/^[=v]+/, '').split('-');
  const nums = core.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, pre];
}

/** Compares two versions (a prerelease sorts before its release). */
function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  if (x[3] === y[3]) return 0;
  return x[3] === '' ? 1 : y[3] === '' ? -1 : x[3] < y[3] ? -1 : 1;
}

/**
 * The lowest version a semver range admits, as { version, exclusive } (exclusive for ">v"), or null
 * when the range has no lower bound (no range, "*", "x", "<12"). An "||" range admits the lowest of
 * its alternatives; a comparator set admits the highest of its lower bounds.
 */
export function rangeLowerBound(range) {
  const text = String(range ?? '').trim();
  if (text === '') return null;
  let lowest;
  for (const alternative of text.split('||')) {
    // "a - b" is a hyphen range; ">= 11" is ">=11" (an operator and its version may be spaced).
    const parts = alternative.trim().replace(/\s+-\s+/, ' - ').replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
    let bound = null;
    const raise = (version, exclusive) => {
      if (bound === null || compareVersions(version, bound.version) > 0 || (compareVersions(version, bound.version) === 0 && exclusive)) bound = { version, exclusive };
    };
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (parts[index + 1] === '-') {
        raise(part, false);
        index += 2;
        continue;
      }
      const match = /^(>=|>|<=|<|\^|~|=)?\s*v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[0-9A-Za-z.-]+)?$/.exec(part);
      if (!match || match[1] === '<' || match[1] === '<=' || /[xX*]/.test(match[2])) continue;
      const version = [match[2], match[3], match[4]].map((piece) => (piece === undefined || /[xX*]/.test(piece) ? '0' : piece)).join('.') + (match[5] ?? '');
      raise(version, match[1] === '>');
    }
    if (bound === null) return null;
    if (lowest === undefined || compareVersions(bound.version, lowest.version) < 0 || (compareVersions(bound.version, lowest.version) === 0 && !bound.exclusive)) lowest = bound;
  }
  return lowest ?? null;
}

/** True when a range admits some version below the floor (a missing or unbounded range always does). */
export function rangeAdmitsBelow(range, floor) {
  const bound = rangeLowerBound(range);
  if (bound === null) return true;
  const order = compareVersions(bound.version, floor);
  return order < 0 && !(bound.exclusive && order === 0);
}

/**
 * The value an override stands for: "$<name>" is npm's reference to the root manifest's own
 * specifier for <name> (devDependencies, optionalDependencies, dependencies, then peerDependencies,
 * as arborist's edge.js resolves it), and an object override's "." is the version it pins.
 * Returns undefined when a reference names nothing the root declares (npm then refuses to install).
 */
export function resolveOverride(rootManifest, value) {
  const plain = value !== null && typeof value === 'object' ? value['.'] : value;
  if (typeof plain !== 'string' || !plain.startsWith('$')) return plain;
  const ref = plain.slice(1);
  for (const section of ['devDependencies', 'optionalDependencies', 'dependencies', 'peerDependencies']) {
    const spec = rootManifest?.[section]?.[ref];
    if (typeof spec === 'string') return spec;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------------

/** The repo-relative path of the policy: --policy, else rn-skills.config.json, else <contractsDir>/dependency-policy.json. */
export function policyPath(layout, option) {
  const configured = layout.config?.[POLICY_CONFIG_KEY];
  return toPosix(option ?? (typeof configured === 'string' ? configured : join(layout.contractsDir, POLICY_FILE)));
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** Levenshtein distance, for "did you mean" hints on unknown keys. */
function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

/** The known key a typo most likely meant (same letters in another case, or a few edits away), or null. */
export function closestKey(key, known) {
  const lower = key.toLowerCase();
  const sameCase = known.find((candidate) => candidate.toLowerCase() === lower);
  if (sameCase) return sameCase;
  const ranked = known.map((candidate) => [candidate, distance(lower, candidate.toLowerCase())]).sort((x, y) => x[1] - y[1]);
  return ranked.length && ranked[0][1] <= Math.max(2, Math.floor(key.length / 4)) ? ranked[0][0] : null;
}

/** An unknown key is ignored by every reader, so the guard it was meant to set stays off: report it. */
function unknownKeyProblems(object, kind, at, errors) {
  if (!isObject(object)) return;
  for (const key of Object.keys(object).filter((item) => !KNOWN_KEYS[kind].includes(item))) {
    const hint = closestKey(key, KNOWN_KEYS[kind].filter((item) => item !== '$comment'));
    errors.push(`${at ? `${at}.` : ''}${key} is not a key of the contract${hint ? ` (did you mean "${hint}"?)` : ''}; readers ignore it, so what it meant to set stays off`);
  }
}

function whereProblems(at, row, errors) {
  const places = placesOf(row);
  const isPlace = (place) => isText(place) && (WHERE_KEYWORDS.has(place) || (!place.startsWith('/') && !place.includes('..')));
  const listed = Array.isArray(row.where);
  if (places.length === 0 || !places.every(isPlace) || (listed && new Set(places).size !== places.length)) {
    return errors.push(`${at}.where must be "app", "dev", a workspace folder, or a list of distinct places (["app", "packages/core"])`);
  }
  if (row.install === 'expo' && places.some((place) => !WHERE_KEYWORDS.has(place))) errors.push(`${at}.where names a workspace folder, but npx expo install writes only into an Expo app: a shared package lists an Expo-managed package as a "*" peer, so the row is "app" (or make it an "npm" row with an exact spec)`);
}

function rowProblems(name, row, errors) {
  const at = `packages.${name}`;
  if (!isObject(row)) return errors.push(`${at} is not an object`);
  unknownKeyProblems(row, 'row', at, errors);
  if (!EXACT_VERSION.test(String(row.version))) errors.push(`${at}.version must be an exact version (got ${JSON.stringify(row.version)})`);
  if (!isText(row.spec)) errors.push(`${at}.spec is missing`);
  else if (EXACT_VERSION.test(String(row.version)) && !specAccepts(row.spec, row.version)) errors.push(`${at}.spec ${row.spec} does not accept version ${row.version}`);
  if (!['expo', 'npm'].includes(row.install)) errors.push(`${at}.install must be "expo" or "npm"`);
  whereProblems(at, row, errors);
  if (!isText(row.why)) errors.push(`${at}.why is missing (say why this package and this version)`);
  for (const [index, companion] of (row.companions ?? []).entries()) {
    unknownKeyProblems(companion, 'companion', `${at}.companions[${index}]`, errors);
    if (!isObject(companion) || !isText(companion.package) || !EXACT_VERSION.test(String(companion.version)) || !['install', 'overrides'].includes(companion.via) || !isText(companion.why)) errors.push(`${at}.companions[${index}] needs package, an exact version, via "install" or "overrides", and why`);
  }
  for (const key of ['implicitUse', 'deprecated']) if (row[key] !== undefined && !isText(row[key])) errors.push(`${at}.${key} must say why`);
}

/**
 * A doNotAdd entry: a reason (the package is kept out of every place and every file), or
 * { reason, where, allowIn? }: kept out of the "where" places only (a row may allow it elsewhere),
 * and imported only by the files the "allowIn" globs match.
 */
function doNotAddProblems(name, entry, packages, errors) {
  const at = `doNotAdd.${name}`;
  if (isText(entry)) return;
  if (!isObject(entry)) return errors.push(`${at} must be a reason, or { "reason", "where", "allowIn" }`);
  unknownKeyProblems(entry, 'doNotAdd', at, errors);
  if (!isText(entry.reason)) errors.push(`${at}.reason is missing: say why the package stays out`);
  if (entry.where === undefined) errors.push(`${at}.where is missing: name the places the package is kept out of ("app", "dev", a workspace folder, or a list)`);
  else whereProblems(at, { where: entry.where }, errors);
  if (entry.allowIn !== undefined && (!Array.isArray(entry.allowIn) || !entry.allowIn.every((glob) => isText(glob) && !glob.startsWith('/') && !glob.includes('..')))) errors.push(`${at}.allowIn must be a list of repo-relative globs (the files that may import it, such as "test/rules/**")`);
  const row = isObject(packages) ? packages[name] : undefined;
  const clash = isObject(row) ? placesOf(row).filter((place) => placesOf(entry).includes(place)) : [];
  if (clash.length > 0) errors.push(`${at}: the row packages.${name} allows it in ${clash.join(', ')}, where doNotAdd keeps it out; scope the entry to the other places or drop the row`);
}

function bannedProblems(list, errors) {
  if (!Array.isArray(list)) return errors.push('"banned" must be a list');
  for (const [index, entry] of list.entries()) {
    unknownKeyProblems(entry, 'banned', `banned[${index}]`, errors);
    if (!isObject(entry) || !isText(entry.pattern) || !['anywhere', 'direct'].includes(entry.scope) || !isText(entry.reason)) {
      errors.push(`banned[${index}] needs pattern, scope "anywhere" or "direct", and reason`);
      continue;
    }
    try {
      new RegExp(entry.pattern);
    } catch {
      errors.push(`banned[${index}].pattern ${entry.pattern} is not a regular expression`);
    }
  }
}

/** Shape problems of a parsed policy (strings), empty when the checkers can use it. */
export function validatePolicy(policy) {
  const errors = [];
  if (!isObject(policy)) return ['the policy must be a JSON object'];
  unknownKeyProblems(policy, 'policy', '', errors);
  if (!Number.isInteger(policy.sdk)) errors.push('"sdk" must be the Expo SDK major the table is for (for example 57)');
  if (!isObject(policy.packages)) errors.push('"packages" must be an object of rows');
  else for (const [name, row] of Object.entries(policy.packages)) rowProblems(name, row, errors);
  if (!Array.isArray(policy.profiles ?? [])) errors.push('"profiles" must be a list of profile names');
  for (const [index, held] of (policy.heldBack ?? []).entries()) {
    unknownKeyProblems(held, 'heldBack', `heldBack[${index}]`, errors);
    if (!isObject(held) || !isText(held.package) || !isText(held.allowed) || !isText(held.trigger)) errors.push(`heldBack[${index}] needs package, allowed (a regex on the bare version) and trigger`);
  }
  if (policy.doNotAdd !== undefined && !isObject(policy.doNotAdd)) errors.push('"doNotAdd" must map package names to reasons');
  else for (const [name, entry] of Object.entries(policy.doNotAdd ?? {})) doNotAddProblems(name, entry, policy.packages, errors);
  bannedProblems(policy.banned, errors);
  if (policy.licenses !== undefined && (!isObject(policy.licenses) || (policy.licenses.allowed !== undefined && !Array.isArray(policy.licenses.allowed)))) errors.push('"licenses" must be { "allowed": [SPDX ids], "exceptions": { ... } }');
  unknownKeyProblems(policy.licenses, 'licenses', 'licenses', errors);
  for (const [name, entry] of Object.entries(isObject(policy.licenses?.exceptions) ? policy.licenses.exceptions : {})) unknownKeyProblems(entry, 'exception', `licenses.exceptions.${name}`, errors);
  return errors;
}

/** Reads and validates the policy: { rel, exists, policy (null unless usable), errors }. */
export function readPolicy(root, rel) {
  const read = readJsonIfPresent(join(root, rel));
  if (!read.ok) return { rel, exists: read.error !== 'missing', policy: null, errors: read.error === 'missing' ? [] : [read.error] };
  const errors = validatePolicy(read.value);
  return { rel, exists: true, policy: errors.length ? null : withDefaults(read.value), errors };
}

function withDefaults(policy) {
  return {
    ...policy,
    profiles: policy.profiles ?? [],
    heldBack: policy.heldBack ?? [],
    doNotAdd: policy.doNotAdd ?? {},
    licenses: { allowed: policy.licenses?.allowed ?? [...DEFAULT_LICENSES], exceptions: policy.licenses?.exceptions ?? {} },
  };
}

/**
 * The entries the policy's "banned" list must hold: the supply-chain floor and every entry of each
 * profile it names (matched by pattern), so the app's own gate (scripts/deps/check-deps.ts), which
 * reads only the contract, enforces the same list. Returns [{ entry, from }] still missing.
 */
export function missingBans(policy, banLists) {
  const have = new Set(policy.banned.map((entry) => entry.pattern));
  const wanted = [...banLists.supplyChain.map((entry) => ({ entry, from: 'the supply-chain floor' }))];
  for (const profile of policy.profiles) for (const entry of banLists.profiles[profile] ?? []) wanted.push({ entry, from: `profile ${profile}` });
  const seen = new Set();
  return wanted.filter(({ entry }) => !have.has(entry.pattern) && !seen.has(entry.pattern) && seen.add(entry.pattern));
}

/** Every ban the checkers enforce: the floor (always), the profiles and the policy's own list. */
export function effectiveBans(policy, banLists) {
  const out = new Map();
  for (const entry of banLists.supplyChain) out.set(entry.pattern, entry);
  for (const profile of policy?.profiles ?? []) for (const entry of banLists.profiles[profile] ?? []) if (!out.has(entry.pattern)) out.set(entry.pattern, entry);
  for (const entry of policy?.banned ?? []) if (!out.has(entry.pattern)) out.set(entry.pattern, { ...entry, regex: new RegExp(entry.pattern) });
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------
// The repo
// ---------------------------------------------------------------------------------------------

/** Name -> spec for dependencies, devDependencies and optionalDependencies (not peers). */
export function installed(manifest) {
  return Object.assign({}, ...SECTIONS.map((section) => manifest?.[section] ?? {}));
}

/** [section, name, spec] for every installed dependency of a manifest. */
export function entriesOf(manifest) {
  return SECTIONS.flatMap((section) => Object.entries(manifest?.[section] ?? {}).map(([name, spec]) => [section, name, spec]));
}

/**
 * Everything the checks read from an app repo. Workspaces come from the root package.json
 * "workspaces" (check-lib's readWorkspaces); without them the root is the one app. Keys of
 * `manifests` are workspace folders ('' is the root). `apps` are the Expo apps (workspaces whose
 * dependencies hold expo; [''] for a single app), `shared` the other workspaces.
 */
export function readRepo(root) {
  const manifests = new Map();
  const errors = [];
  const rootRead = readJsonIfPresent(join(root, 'package.json'));
  if (rootRead.ok) manifests.set('', rootRead.value);
  else if (rootRead.error !== 'missing') errors.push({ file: 'package.json', message: rootRead.error });
  const workspaces = readWorkspaces(root);
  for (const workspace of workspaces) {
    if (workspace.manifest) manifests.set(workspace.dir, workspace.manifest);
    else errors.push({ file: `${workspace.dir}/package.json`, message: 'not valid JSON' });
  }
  const mode = workspaces.length > 0 ? 'monorepo' : 'single';
  const apps = mode === 'single' ? [''] : workspaces.filter((w) => w.manifest?.dependencies?.expo !== undefined).map((w) => w.dir);
  const shared = mode === 'single' ? [] : workspaces.map((w) => w.dir).filter((dir) => !apps.includes(dir));
  const names = new Map(workspaces.filter((w) => w.name).map((w) => [w.name, w.dir]));
  const lock = readJsonIfPresent(join(root, 'package-lock.json'));
  if (!lock.ok && lock.error !== 'missing') errors.push({ file: 'package-lock.json', message: lock.error });
  const npmrcPath = join(root, '.npmrc');
  return {
    root,
    mode,
    apps,
    shared,
    workspaceNames: names,
    manifests,
    errors,
    lockfile: lock.ok ? lock.value : null,
    npmrc: existsSync(npmrcPath) ? readFileSync(npmrcPath, 'utf8') : null,
  };
}

/** The manifest file of a workspace key. */
export const manifestFile = (ws) => (ws === '' ? 'package.json' : `${ws}/package.json`);

/** The Expo SDK major the apps use (from the "expo" specifier), or null. */
export function repoSdk(repo) {
  for (const app of repo.apps) {
    const spec = repo.manifests.get(app)?.dependencies?.expo;
    if (spec) return majorOf(spec);
  }
  return null;
}

/**
 * Where a declared dependency sits, in the vocabulary of a row's "where": 'app' (an app's runtime
 * dependencies), 'dev' (the root devDependencies), a shared workspace folder, or a description of
 * a place no row can name. A row allows the place when placesOf(row) includes it.
 */
export function placeOf(repo, ws, section) {
  const isApp = repo.apps.includes(ws);
  if (repo.mode === 'single') return section === 'devDependencies' ? 'dev' : 'app';
  if (ws === '') return section === 'devDependencies' ? 'dev' : 'root dependencies';
  if (isApp) return section === 'devDependencies' ? `${ws} devDependencies` : 'app';
  return ws;
}

/** A place, or a row's "where" (one place or a list), in words, for messages. */
export function describePlace(repo, where) {
  if (Array.isArray(where)) return where.map((place) => describePlace(repo, place)).join(' or ');
  if (where === 'app') return repo.mode === 'single' ? 'dependencies' : "the apps' dependencies";
  if (where === 'dev') return repo.mode === 'single' ? 'devDependencies' : 'the root devDependencies';
  return where.includes(' ') ? where : `${where}/package.json`;
}

/**
 * The module map `npx expo install` uses: the installed expo's bundledNativeModules.json (root, or
 * an app's node_modules), else this skill's copy when the SDK matches, else null.
 */
export function moduleMapFor(repo, sdk) {
  for (const base of ['', ...repo.apps.filter(Boolean)]) {
    const installedMap = join(repo.root, base, 'node_modules', 'expo', 'bundledNativeModules.json');
    if (!existsSync(installedMap)) continue;
    try {
      return { map: readJson(installedMap), source: toPosix(join(base, 'node_modules/expo/bundledNativeModules.json')) };
    } catch {
      // fall through to the next copy
    }
  }
  const own = join(ASSETS, `expo-sdk-${sdk}-module-map.json`);
  if (sdk !== null && existsSync(own)) return { map: readJson(own), source: `the skill's SDK ${sdk} module map (expo ${MODULE_MAP_SOURCE.expo})` };
  return null;
}

// ---------------------------------------------------------------------------------------------
// .npmrc
// ---------------------------------------------------------------------------------------------

const EXCLUDE_KEY = /^min-release-age-exclude(\[\])?$/;
export const EXCLUDE_HEADER = /^# exclude-block expires=(\d{4}-\d{2}-\d{2}) reason=\S.*$/;
const DAY_MS = 86_400_000;
const INI_LINE = /^([^=]+)(=(.*))?$/;

/**
 * A key or value the way npm 11.17's ini parser (ini 6) reads it: trimmed; one pair of matching
 * quotes removed ('"true"' is true); otherwise an unescaped "#" or ";" starts a comment
 * ("min-release-age=7 # why" is 7) and "\#", "\;" are the literal characters (all verified with
 * npm config get on npm 11.17.0).
 */
export function iniValue(raw) {
  const text = String(raw ?? '').trim();
  const quote = text.charAt(0);
  if (text.length >= 2 && (quote === '"' || quote === "'") && text.endsWith(quote)) {
    const inner = quote === "'" ? text.slice(1, -1) : text;
    try {
      return String(JSON.parse(inner));
    } catch {
      return quote === "'" ? inner : text;
    }
  }
  let out = '';
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      out += '\\;#'.includes(ch) ? ch : `\\${ch}`;
      escaped = false;
    } else if (ch === ';' || ch === '#') break;
    else if (ch === '\\') escaped = true;
    else out += ch;
  }
  return (escaped ? `${out}\\` : out).trim();
}

/**
 * One setting line of an .npmrc as npm reads it (ini): a line that starts with "#" or ";" is a
 * comment and "[name]" a section header (both null); otherwise "key=value" (spaces around "="
 * allowed), or a bare "key" with no "=", which reads as true. An empty value ("key=") also reads as
 * true (verified: "legacy-peer-deps" and "legacy-peer-deps=" both make `npm config get
 * legacy-peer-deps` print true). Returns { key, value } or null.
 */
export function parseNpmrcLine(rawLine) {
  const line = String(rawLine).replace(/\r$/, '');
  if (/^\s*([;#]|$)/.test(line) || /^\s*\[[^\]]*\]\s*$/.test(line)) return null;
  const match = INI_LINE.exec(line);
  const key = match ? iniValue(match[1]) : '';
  if (key === '') return null;
  const value = match[2] === undefined ? '' : iniValue(match[3]);
  return { key, value: value === '' ? 'true' : value };
}

/** Every setting of an .npmrc: [{ line (1-based), key, value }]. */
export function npmrcSettings(text) {
  return (text ?? '').split(/\r?\n/).flatMap((line, index) => {
    const setting = parseNpmrcLine(line);
    return setting ? [{ line: index + 1, ...setting }] : [];
  });
}

/**
 * The policy lines. npm keeps the LAST value of a key, so a later line can switch one off.
 * min-release-age is a floor: 7 days or more (an app may be stricter, for example 14).
 * strict-allow-scripts=true makes npm refuse an install whose tree holds an install script that
 * allowScripts does not cover, before anything runs (ESTRICTALLOWSCRIPTS); without it npm 11.17 runs
 * the unreviewed script and only prints a notice afterwards (verified 2026-10-03).
 */
export const NPMRC_POLICY = Object.freeze({ 'min-release-age': String(RELEASE_AGE_MIN_DAYS), 'engine-strict': 'true', 'save-exact': 'true', 'strict-allow-scripts': 'true' });

/**
 * Keys that switch a guard off when the project .npmrc (or an NPM_CONFIG_* variable) sets them, each
 * verified on npm 11.17: `allowed` is the one harmless value, or null when any value is a finding.
 * Only the exact harmless value passes: npm keeps other spellings ("0", "no", "False") as truthy
 * strings, so they are findings too.
 */
export const NPMRC_FORBIDDEN = Object.freeze({
  'legacy-peer-deps': { allowed: 'false', why: 'npm then ignores peerDependencies, so an install off the SDK set resolves instead of failing with ERESOLVE (an ERESOLVE means: go back to the policy row)' },
  force: { allowed: 'false', why: 'npm then overrides conflicts and protections (ERESOLVE, EBADENGINE) for every install' },
  'dangerously-allow-all-scripts': { allowed: 'false', why: 'npm then runs every install script, approved or not, past allowScripts and strict-allow-scripts' },
  'package-lock': { allowed: 'true', why: 'npm install (what developers run, and EAS Build under EAS_NO_FROZEN_LOCKFILE) then ignores package-lock.json and stops writing it, so every install resolves a fresh tree' },
  before: { allowed: null, why: 'a before date replaces min-release-age (npm uses before and drops the age), so a future date lets every release in on the day it appears' },
  'allow-scripts': { allowed: null, why: 'approvals belong in the root package.json allowScripts, pinned to the reviewed version and visible in the diff; npm 11.17 refuses this key from a variable or the command line for any install inside the project (EALLOWSCRIPTS), ignores an .npmrc line next to package.json allowScripts except for npx, and passes it from any layer to every script it runs, so an npm install started by an npm script fails' },
});

/**
 * True when a value is acceptable for a policy key. min-release-age is a number of days (npm reads
 * it as a Number: "10.5" is 10.5 days), at least the floor; the others must be exactly "true".
 */
function policyValueOk(key, value) {
  if (key === 'min-release-age') return String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= RELEASE_AGE_MIN_DAYS;
  return value === NPMRC_POLICY[key];
}

/** Policy keys that no line of the .npmrc sets to an acceptable value. */
export function npmrcPolicyMissing(text) {
  const settings = npmrcSettings(text);
  return Object.keys(NPMRC_POLICY).filter((key) => !settings.some((setting) => setting.key === key && policyValueOk(key, setting.value)));
}

/** Lines that set a policy key to anything but an acceptable value (for example a later min-release-age=0). */
export function npmrcPolicyOverrides(text) {
  return npmrcSettings(text)
    .filter((setting) => NPMRC_POLICY[setting.key] !== undefined && !policyValueOk(setting.key, setting.value))
    .map((setting) => ({ ...setting, want: NPMRC_POLICY[setting.key] }));
}

/** Lines that set a forbidden key (NPMRC_FORBIDDEN) to anything but its harmless value. */
export function npmrcForbidden(text) {
  return npmrcSettings(text)
    .filter((setting) => Object.hasOwn(NPMRC_FORBIDDEN, setting.key) && setting.value !== NPMRC_FORBIDDEN[setting.key].allowed)
    .map((setting) => ({ ...setting, why: NPMRC_FORBIDDEN[setting.key].why }));
}

/**
 * The npm config key an environment variable sets, the way npm 11.17 reads the environment
 * (@npmcli/config): npm_config_<name> in any case, every "_" after the first character a "-", the
 * name lower-cased ("NPM_CONFIG_LEGACY_PEER_DEPS" -> "legacy-peer-deps"). Null for other names.
 */
export function npmEnvKey(name) {
  const match = /^npm_config_(.+)$/i.exec(String(name));
  if (!match) return null;
  return match[1].startsWith('//') ? match[1] : match[1].replace(/(?!^)_/g, '-').toLowerCase();
}

/**
 * What an npm config value from outside the project .npmrc does to the policy (an NPM_CONFIG_*
 * variable beats the project .npmrc): { kind, text } or null when harmless. npm ignores an empty
 * variable. kind is 'policy' (a policy key below the policy), 'forbidden' (a key that switches a
 * guard off) or 'exclude' (an exclude outside the dated blocks: an environment list replaces the
 * whole project list, so the blocks and their expiry stop counting).
 */
export function npmConfigFinding(key, value) {
  const text = String(value ?? '');
  if (text === '') return null;
  if (Object.hasOwn(NPMRC_POLICY, key)) return policyValueOk(key, text) ? null : { kind: 'policy', text: `${key}=${text} is outside the policy (${key === 'min-release-age' ? `min-release-age=${RELEASE_AGE_MIN_DAYS} or higher` : `${key}=${NPMRC_POLICY[key]}`})` };
  if (Object.hasOwn(NPMRC_FORBIDDEN, key)) return text === NPMRC_FORBIDDEN[key].allowed ? null : { kind: 'forbidden', text: `${key}=${text}: ${NPMRC_FORBIDDEN[key].why}` };
  if (EXCLUDE_KEY.test(key)) return { kind: 'exclude', text: `${key}=${text} replaces every dated exclude block of the project .npmrc with an undated list that never expires` };
  return null;
}

/** The release age npm applies (the last acceptable min-release-age line), else the 7-day floor. */
export function releaseAgeDays(text) {
  const values = npmrcSettings(text).filter((setting) => setting.key === 'min-release-age' && policyValueOk(setting.key, setting.value));
  return values.length ? Number(values.at(-1).value) : RELEASE_AGE_MIN_DAYS;
}

/** The exclude value of a line in any spelling npm accepts ("x[]=p", "x = p"), or null. */
export function excludePattern(line) {
  const setting = parseNpmrcLine(line);
  return setting && EXCLUDE_KEY.test(setting.key) ? setting.value : null;
}

/** npm splits one exclude value on commas ("expo,expo-*" is two patterns; arborist definitions.js). */
export const excludeParts = (value) => String(value).split(',').map((part) => part.trim()).filter(Boolean);

/**
 * True when an exclude pattern matches every package name, or every scoped one: nothing but glob
 * characters ("*", "**", "*\/*", "@*\/*", "?*"). Such a pattern switches the release age off for
 * the whole tree, not for the one release a block exists for.
 */
export const isCatchAll = (pattern) => /^[*?/@]+$/.test(pattern);

/** YYYY-MM-DD plus a number of days. */
export const addDays = (dayIso, days) => new Date(Date.parse(`${dayIso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Dated exclude blocks of an .npmrc: every exclude must sit in a block that has not expired, name
 * real packages (no catch-all pattern), and a block's expiry can never be later than today plus the
 * release age: the release it exists for was published on or before today, and the block is due
 * on its publish date plus the release age. A later date was extended or invented. A header comment
 * that still holds the literal placeholder "expires=YYYY-MM-DD" is documentation.
 */
export function npmrcExcludeProblems(text, todayIso) {
  const problems = [];
  const limit = addDays(todayIso, releaseAgeDays(text));
  let expires = null;
  (text ?? '').split(/\r?\n/).forEach((line, index) => {
    const header = EXCLUDE_HEADER.exec(line);
    const looseHeader = /^#\s*exclude-block\b/.test(line) && !line.includes('expires=YYYY-MM-DD');
    const pattern = excludePattern(line);
    if (header) {
      expires = header[1];
      if (expires > limit) problems.push({ line: index + 1, pattern: '', kind: 'outlives', expires, limit });
    } else if (looseHeader) problems.push({ line: index + 1, pattern: '', kind: 'bad-header' });
    else if (line.trim() === '') expires = null;
    else if (pattern === null) return;
    else if (expires === null) problems.push({ line: index + 1, pattern, kind: 'no-block' });
    else if (expires < todayIso) problems.push({ line: index + 1, pattern, kind: 'expired', expires });
    for (const part of pattern === null ? [] : excludeParts(pattern).filter(isCatchAll)) problems.push({ line: index + 1, pattern: part, kind: 'catch-all' });
  });
  return problems;
}

/** npm matches exclude patterns with minimatch: "*" stays inside one path segment, "**" crosses "/". */
function excludeRegex(pattern) {
  const source = pattern.split(/(\*\*|\*|\?)/).map((part) => (part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.+^${}()|[\]\\/]/g, (ch) => `\\${ch}`))).join('');
  return new RegExp(`^${source}$`);
}

/**
 * The exclude patterns npm applies today that the policy accepts: [{ expires, pattern, regex }]
 * for every pattern inside a dated, unexpired block that does not outlive its release and is no
 * catch-all. (npm would also honour an undated, expired or catch-all exclude; check-deps-policy.mjs
 * fails those, so a plan never counts on them.)
 */
export function activeExcludes(text, todayIso) {
  const out = [];
  const limit = addDays(todayIso, releaseAgeDays(text));
  let expires = null;
  for (const line of (text ?? '').split(/\r?\n/)) {
    const header = EXCLUDE_HEADER.exec(line);
    const pattern = excludePattern(line);
    if (header) expires = header[1];
    else if (line.trim() === '') expires = null;
    else if (pattern !== null && expires !== null && expires >= todayIso && expires <= limit) {
      for (const part of excludeParts(pattern).filter((item) => !isCatchAll(item))) out.push({ expires, pattern: part, regex: excludeRegex(part) });
    }
  }
  return out;
}

/** Package name from a lockfile path: "node_modules/a/node_modules/@s/b" -> "@s/b". */
export function lockName(path) {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/**
 * The shell command lines of a YAML file that runs commands (a GitHub workflow, lefthook.yml): the
 * value of every `run:` key, and each line of a `run: |` or `run: >` block, with its 1-based line.
 * Comments, step names and other keys are not commands, so a `name: npx eas-cli` stays silent.
 */
export function yamlRunLines(text) {
  const out = [];
  let block = null;
  String(text).split(/\r?\n/).forEach((line, index) => {
    const indent = line.length - line.trimStart().length;
    if (block !== null) {
      if (line.trim() === '' || indent > block) {
        if (line.trim() !== '' && !line.trim().startsWith('#')) out.push({ line: index + 1, command: line.trim() });
        return;
      }
      block = null;
    }
    const match = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(line);
    if (!match) return;
    const value = match[2].trim();
    if (/^[|>][-+0-9]*\s*(#.*)?$/.test(value)) block = match[1].length;
    else if (value !== '' && !value.startsWith('#')) out.push({ line: index + 1, command: value.replace(/^(["'])(.*)\1$/, '$2') });
  });
  return out;
}

/** npx / npm exec flags that take the next word as their value when written without "=". */
const NPX_VALUE_FLAGS = new Set(['-p', '--package', '-c', '--call', '-w', '--workspace', '--prefix', '--cache', '--registry', '--userconfig', '--loglevel', '--allow-scripts', '--script-shell', '--node-options', '--min-release-age', '--before']);

/** A package spec as npx reads it: { name, version } (version null when none), or null for a path, URL or git spec. */
export function parseNpxSpec(raw) {
  const spec = String(raw);
  if (/^(\.|\/|~|file:|git[+:]|https?:|github:|npm:)/.test(spec)) return null;
  const match = /^((?:@[^/@\s]+\/)?[^/@\s]+)(?:@(.*))?$/.exec(spec);
  return match ? { name: match[1], version: match[2] === undefined || match[2] === '' ? null : match[2] } : null;
}

/**
 * Every npx / `npm exec` / `npm x` call in one shell command line, as npm 11.17 parses it:
 * { packages: [{ name, version }], command, flags } where packages are the --package values or,
 * without one, the command itself (npx then installs the package of that name when no local bin or
 * package matches). Calls that never install (--no, -n, --no-install) and -c/--call calls without a
 * --package are left out. Shell operators split the line into separate commands.
 */
export function npxCalls(command) {
  const calls = [];
  for (const segment of String(command).split(/&&|\|\||[;|&()`]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/^(["'])(.*)\1$/, '$2'));
    for (let i = 0; i < words.length; i += 1) {
      const isNpx = words[i] === 'npx';
      const isExec = words[i] === 'npm' && (words[i + 1] === 'exec' || words[i + 1] === 'x');
      if (!isNpx && !isExec) continue;
      const packages = [];
      const flags = new Set();
      let call = false;
      let cmd = null;
      let j = i + (isNpx ? 1 : 2);
      for (; j < words.length; j += 1) {
        const word = words[j];
        if (word === '--') {
          cmd = words[j + 1] ?? null;
          break;
        }
        if (!word.startsWith('-')) {
          cmd = word;
          break;
        }
        const at = word.indexOf('=');
        const name = at < 0 ? word : word.slice(0, at);
        let value = at < 0 ? null : word.slice(at + 1);
        if (value === null && NPX_VALUE_FLAGS.has(name)) {
          j += 1;
          value = words[j] ?? '';
        }
        flags.add(name);
        if (name === '-p' || name === '--package') packages.push(...String(value).split(',').filter(Boolean));
        if (name === '-c' || name === '--call') call = true;
      }
      i = j;
      if (flags.has('--no') || flags.has('-n') || flags.has('--no-install')) continue;
      const specs = (packages.length ? packages : call || cmd === null ? [] : [cmd]).map(parseNpxSpec).filter(Boolean);
      if (specs.length) calls.push({ packages: specs, command: cmd, viaPackageFlag: packages.length > 0, flags });
    }
  }
  return calls;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
