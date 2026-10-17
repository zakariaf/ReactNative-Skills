// privacy-scan.mjs: what this skill's checkers share (a helper, not an entry point): the facts in
// assets/, the app's contracts/privacy.json read and validated, the installed packages, the app's
// runtime source files, import parsing and the first-party network seams the profile allows.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments, matchGlob, readWorkspaces, toPosix, walkRepo } from '../check-lib.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

/** assets/privacy-facts.json and assets/data-types.json, parsed once. */
export const FACTS = JSON.parse(readFileSync(join(ASSETS, 'privacy-facts.json'), 'utf8'));
export const DATA_TYPES = JSON.parse(readFileSync(join(ASSETS, 'data-types.json'), 'utf8'));

export const PROFILES = Object.freeze(['api-port', 'offline-only']);
const CONTRACT_KEYS = new Set(['$schema', '$comment', 'profile', 'networkModules', 'linkFiles', 'sdks', 'app', 'accountDeletion', 'permissionAnswers']);
const SDK_KEYS = new Set(['$comment', 'family', 'why', 'pods', 'maven', 'tracking', 'collects']);
const COLLECT_KEYS = new Set(['type', 'linked', 'tracking', 'purposes', 'shared', 'optional']);
const ANSWER = /^(collected: [a-z-]+(, [a-z-]+)*|not-collected: .{10,})$/;

/** 1-based line of a character index. */
export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function readRepoText(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/** Parsed JSON, or null when the file is missing or not JSON. */
export function readRepoJson(root, rel) {
  if (!existsSync(join(root, rel))) return null;
  try {
    return JSON.parse(readRepoText(root, rel));
  } catch {
    return null;
  }
}

/** Test code: Jest files, __tests__/, the root __mocks__/ and test/ helpers never ship. */
export function isTestFile(rel) {
  return /\.(test|spec|golden\.test|sim\.test)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('/__tests__/') || /^(__mocks__|test)\//.test(rel);
}

/** Where the contract lives: --contract, rn-skills.config.json "privacyContract", else <contractsDir>/privacy.json. */
export function contractPath(layout, given) {
  return given ?? layout.config?.privacyContract ?? `${layout.contractsDir}/privacy.json`;
}

/**
 * The app's contracts/privacy.json with defaults filled in, and every way it breaks the format
 * ({ contract, problems: [{ message, fix }], missing }). A missing file is { missing: true } with one problem.
 */
export function readContract(root, rel) {
  const fix = 'Copy templates/contracts/privacy.json (and privacy.schema.json) from this skill and fill it in for this app (references/store-declarations.md).';
  if (!existsSync(join(root, rel))) return { contract: null, missing: true, problems: [{ message: 'missing: the app declares no network profile, SDKs or store answers', fix }] };
  let data;
  try {
    data = JSON.parse(readRepoText(root, rel));
  } catch (error) {
    return { contract: null, missing: false, problems: [{ message: `not valid JSON (${error.message})`, fix: 'Repair the JSON (the schema beside it lists every key).' }] };
  }
  const problems = [];
  const add = (message, hint = 'See contracts/privacy.schema.json and references/store-declarations.md.') => problems.push({ message, fix: hint });
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { contract: null, missing: false, problems: [{ message: 'is not a JSON object', fix }] };
  for (const key of Object.keys(data)) if (!CONTRACT_KEYS.has(key)) add(`unknown key "${key}"`);
  const profile = data.profile ?? 'api-port';
  if (!PROFILES.includes(profile)) add(`profile "${profile}" is not one of ${PROFILES.join(', ')}`);
  const globs = (key) => {
    const value = data[key] ?? [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.startsWith('/') || item.split('/').includes('..'))) {
      add(`${key} must be a list of repo-relative paths or globs`);
      return [];
    }
    return value;
  };
  const networkModules = globs('networkModules');
  const linkFiles = globs('linkFiles');
  if (profile === 'offline-only' && networkModules.length > 0) add(`networkModules lists ${networkModules.join(', ')}, but the offline-only profile allows no first-party network module`, 'Remove them, or move the app to the api-port profile (the default) if it really talks to a server.');
  const collects = (owner, list) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      add(`${owner}.collects must be a list`);
      return [];
    }
    return list.flatMap((item, index) => {
      const where = `${owner}.collects[${index}]`;
      if (typeof item !== 'object' || item === null) {
        add(`${where} is not an object`);
        return [];
      }
      for (const key of Object.keys(item)) if (!COLLECT_KEYS.has(key)) add(`${where} has an unknown key "${key}"`);
      if (DATA_TYPES.types[item.type] === undefined) add(`${where}.type "${item.type}" is not a known data type`, 'Use an id from assets/data-types.json (device-id, coarse-location, crash-data, ...).');
      if (typeof item.linked !== 'boolean' || typeof item.tracking !== 'boolean') add(`${where} needs linked and tracking as true or false`);
      const purposes = Array.isArray(item.purposes) ? item.purposes : [];
      if (purposes.length === 0) add(`${where} names no purposes`);
      for (const purpose of purposes) if (DATA_TYPES.purposes[purpose] === undefined) add(`${where} purpose "${purpose}" is not known`, `Use one of ${Object.keys(DATA_TYPES.purposes).join(', ')}.`);
      return [{ ...item, purposes }];
    });
  };
  const sdks = {};
  const rawSdks = data.sdks ?? {};
  if (typeof rawSdks !== 'object' || rawSdks === null || Array.isArray(rawSdks)) add('sdks must be an object keyed by npm package name');
  else {
    for (const [name, entry] of Object.entries(rawSdks)) {
      if (typeof entry !== 'object' || entry === null) {
        add(`sdks["${name}"] is not an object`);
        continue;
      }
      for (const key of Object.keys(entry)) if (!SDK_KEYS.has(key)) add(`sdks["${name}"] has an unknown key "${key}"`);
      if (typeof entry.why !== 'string' || entry.why.trim().length < 10) add(`sdks["${name}"] has no real "why" (what the app uses it for, at least ten characters)`);
      const pods = Array.isArray(entry.pods) ? entry.pods.filter((pod) => typeof pod === 'string') : [];
      const maven = Array.isArray(entry.maven) ? entry.maven.filter((group) => typeof group === 'string') : [];
      sdks[name] = { name, why: entry.why, pods, maven, tracking: entry.tracking === true, collects: collects(`sdks["${name}"]`, entry.collects) };
    }
  }
  const app = { collects: collects('app', data.app?.collects) };
  const answers = data.permissionAnswers ?? {};
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) add('permissionAnswers must be an object keyed by permission kind');
  else for (const [kind, answer] of Object.entries(answers)) if (typeof answer !== 'string' || !ANSWER.test(answer)) add(`permissionAnswers["${kind}"] is not "collected: <type>[, <type>]" or "not-collected: <why, at least ten characters>"`);
  const deletion = data.accountDeletion ?? null;
  if (deletion !== null && (typeof deletion !== 'object' || typeof deletion.inApp !== 'string' || typeof deletion.webUrl !== 'string')) add('accountDeletion must be null or { "inApp": "<route file>", "webUrl": "https://..." }');
  return { contract: { profile, networkModules, linkFiles, sdks, app, permissionAnswers: typeof answers === 'object' && answers !== null ? answers : {}, accountDeletion: deletion }, missing: false, problems };
}

/** Every collects row of the contract, with its owner (an SDK name or "app"). */
export function allCollects(contract) {
  return [...Object.values(contract.sdks).flatMap((sdk) => sdk.collects.map((row) => ({ ...row, owner: sdk.name }))), ...contract.app.collects.map((row) => ({ ...row, owner: 'app' }))];
}

/** True when anything the contract declares is used for tracking. */
export function declaresTracking(contract) {
  return allCollects(contract).some((row) => row.tracking);
}

/** The data types an answer "collected: a, b" names. */
export function answerTypes(answer) {
  return answer.startsWith('collected: ') ? answer.slice('collected: '.length).split(', ') : [];
}

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies'];

/**
 * The packages the app ships. direct: the app's own dependencies, plus the dependencies of every
 * workspace package it depends on, transitively (a workspace package's SDK ships in the app as if the
 * app had installed it); with the app at the repo root, every workspace counts. anywhere: direct plus
 * every non-dev package of the repo root's package-lock.json (npm workspaces keep one lockfile at the
 * root) and of the app's own lockfile when it has one (lockfile v3 "dev": true is left out).
 * appInRepo is the app folder relative to repoRoot ('.' for a single app).
 */
export function installedPackages(repoRoot, appInRepo = '.') {
  const appRoot = join(repoRoot, appInRepo);
  const prefix = appInRepo === '.' ? '' : `${toPosix(appInRepo).replace(/\/$/, '')}/`;
  const direct = new Map();
  const workspaces = new Map(readWorkspaces(repoRoot).map((ws) => [ws.manifest?.name ?? ws.dir, ws]));
  const addDeps = (json, label) => {
    const names = DEPENDENCY_FIELDS.flatMap((field) => Object.keys(json?.[field] ?? {}));
    for (const name of names) if (!direct.has(name)) direct.set(name, label);
    return names;
  };
  const queue = addDeps(readRepoJson(appRoot, 'package.json'), 'package.json');
  if (prefix === '') queue.push(...workspaces.keys());
  const visited = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    const ws = workspaces.get(name);
    if (ws === undefined || visited.has(name) || toPosix(ws.dir) === toPosix(appInRepo)) continue;
    visited.add(name);
    queue.push(...addDeps(ws.manifest ?? readRepoJson(repoRoot, `${ws.dir}/package.json`), `${ws.dir}/package.json`));
  }
  const anywhere = new Map();
  const locks = [[readRepoJson(repoRoot, 'package-lock.json'), 'package-lock.json']];
  if (prefix !== '') locks.push([readRepoJson(appRoot, 'package-lock.json'), `${prefix}package-lock.json`]);
  for (const [lock, label] of locks) {
    for (const [path, entry] of Object.entries(lock?.packages ?? {})) {
      const at = path.lastIndexOf('node_modules/');
      if (at === -1 || entry?.dev === true) continue;
      const name = path.slice(at + 'node_modules/'.length);
      if (!anywhere.has(name)) anywhere.set(name, { path, lock: label });
    }
  }
  for (const [name, label] of direct) if (!anywhere.has(name)) anywhere.set(name, { path: label, lock: label });
  return { direct, anywhere, hasLock: locks.some(([lock]) => lock !== null) };
}

/** The network-capable family a package belongs to, with its facts entry, or null. */
export function networkFamilyOf(name) {
  return FACTS.networkSdks.find((entry) => new RegExp(entry.pattern).test(name)) ?? null;
}

/** The app's runtime source files (repo-relative posix): srcDir and the routes folder, no tests, no .d.ts, no server routes. */
export function runtimeSourceFiles(root, layout) {
  const bases = [...new Set([layout.srcDir, layout.routesDir])].filter((base) => existsSync(join(root, base)));
  const files = new Set();
  for (const rel of walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'] })) {
    if (!bases.some((base) => rel === base || rel.startsWith(`${base}/`))) continue;
    if (rel.endsWith('.d.ts') || isTestFile(rel) || /\+(api|middleware)\.[jt]sx?$/.test(rel)) continue;
    files.add(rel);
  }
  return [...files].sort();
}

/** Where first-party code may open a connection: the API folder (api-port) plus networkModules; nowhere (offline-only). */
export function networkSeams(contract, layout) {
  if (contract.profile === 'offline-only') return [];
  return [`${layout.apiDir}/**`, ...contract.networkModules];
}

/**
 * Where first-party code may hold a remote URL literal: the config folder (api-port: the API base URL
 * from EXPO_PUBLIC_API_URL, links) and linkFiles. Never the API folder: endpoints are paths on that base
 * (networking-and-server-state's base-url rule, and the lint config's URL zone).
 */
export function urlSeams(contract, layout) {
  const own = contract.profile === 'offline-only' ? [] : [`${layout.configDir}/**`];
  return [...own, ...contract.linkFiles];
}

/** True when a repo-relative path matches one of the globs (a glob without a slash matches any segment). */
export function matchesAny(rel, globs) {
  return globs.some((glob) => matchGlob(rel, glob));
}

/**
 * A source-map source as repo-relative paths. Expo roots first-party sources at the project
 * ('/src/api/fetch-api-client.ts') and gives packages absolute paths; older maps climb out of the export folder with ./ and ../ segments.
 * Returns the path and every suffix at a folder boundary, so 'x/src/api/a.ts' still matches
 * 'src/api/**' when the export ran from another folder.
 */
export function sourceCandidates(source, appRoot) {
  let path = toPosix(source).replace(/^[a-z]+:\/\/\/?/i, '');
  const root = toPosix(appRoot).replace(/\/$/, '');
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  path = path.replace(/^(\.\.?\/)+|^\/+/, '');
  const parts = path.split('/');
  return parts.map((_, index) => parts.slice(index).join('/'));
}

/** Metro's virtual modules ('\0polyfill:...') belong to no file and no package. */
export function isVirtualModule(source) {
  return source.startsWith('\0');
}

/** The npm package a source-map source belongs to ('@scope/name' or 'name'), or null for first-party code. */
export function packageOf(source) {
  return /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(toPosix(source))?.[1] ?? null;
}

/**
 * Static imports, re-exports, requires and dynamic imports of a module source (comments masked).
 * [{ specifier, isType, line }]
 */
export function parseImports(source) {
  const text = maskComments(source);
  const out = [];
  for (const match of text.matchAll(/\bimport\s+(type\s+)?[^'";]*?\s*from\s*['"]([^'"]+)['"]/g)) out.push({ specifier: match[2], isType: Boolean(match[1]), line: lineAt(text, match.index) });
  for (const match of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push({ specifier: match[1], isType: false, line: lineAt(text, match.index) });
  for (const match of text.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ specifier: match[1], isType: false, line: lineAt(text, match.index) });
  for (const match of text.matchAll(/\bexport\s+(type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*['"]([^'"]+)['"]/g)) out.push({ specifier: match[2], isType: Boolean(match[1]), line: lineAt(text, match.index) });
  return out;
}

/** The app config sources prebuild evaluates: app.config.ts/.js/app.json at the app root and the configDir files they use. */
export function configSources(root, layout) {
  const files = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.json'].filter((rel) => existsSync(join(root, rel)));
  if (existsSync(join(root, layout.configDir))) {
    for (const rel of walkRepo(root, { include: ['*.ts', '*.js'] })) if (rel.startsWith(`${layout.configDir}/`) && !isTestFile(rel)) files.push(rel);
  }
  if (existsSync(join(root, 'plugins'))) for (const rel of walkRepo(root, { include: ['*.ts', '*.js'] })) if (rel.startsWith('plugins/') && !isTestFile(rel)) files.push(rel);
  return [...new Set(files)];
}
