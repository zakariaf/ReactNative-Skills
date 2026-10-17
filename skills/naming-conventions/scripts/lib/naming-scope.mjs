// naming-scope.mjs: what the naming checkers scan in an app repo and the repo's naming contract
// (a helper, not an entry point).
//
//   namingContext(root, { contract }) -> {
//     root, layout, contract, hasContract, contractFile, contractLine(value), apps, ownedRoots,
//     isOwned(rel), roleOf(rel, key), appOf(rel), isAppCode(rel), isNodeCode(rel), isServerCode(rel), isRuntime(rel),
//     isTooling(rel), isTest(rel), testIdRoles, isPublishedAppId(id, platform), isPublishedSlug(slug),
//     isPublishedProductId(id)
//   }
//
// Folders come from check-lib's resolveLayout(root): the canonical single-app layout (src/ and its role
// folders, an app/ routes folder when src/app does not exist, test/, scripts/, __mocks__/, .maestro/,
// contracts/, plugins/), tsconfig paths, package.json workspaces and
// the optional rn-skills.config.json (its "namingContract" key moves contracts/naming.json). In a
// multi-package repo every workspace folder is scanned too, with its own layout. A missing default
// contract means library defaults; a contract named by --contract or "namingContract" must exist.
// Three kinds of code read env variables differently: runtime code (the app bundle: only inlined
// EXPO_PUBLIC_* names), server code (API routes, +middleware, src/server/: any name) and Node code
// (app.config.ts, plugins, scripts, tests, the contract's "nodeCode" globs: any name).

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { UsageError, matchGlob, resolveLayout, toPosix } from '../check-lib.mjs';
import { LOCALE_TAG, KEBAB, RULES } from './names.mjs';
import { isExpoApp } from './workspaces.mjs';

export const CONTRACT_NAME = 'naming.json';

const CONTRACT_KEYS = {
  $comment: 'string',
  pathHeader: 'boolean',
  slugMatchesAppFolder: 'boolean',
  locales: 'string[]',
  keyAreas: 'string[]',
  allowedIndexFiles: 'string[]',
  nodeCode: 'string[]',
  extraTestIdRoles: 'string[]',
  extraE2eFolders: 'object[]',
  canonical: 'object',
  storeProductIds: 'string[]',
  publishedAppIds: 'object[]',
  publishedSlugs: 'object[]',
  publishedProductIds: 'object[]',
};
const CANONICAL_KEYS = ['types', 'npmScripts', 'envVars'];

// The object lists of the contract. Ids that are already live on a store or name an existing EAS
// project are permanent, so app-id and product-id accept them as they are; a platform goes with an app
// id, because iOS and Android ids are created separately. An extra e2e folder holds flows that CI does
// not run (a screenshot matrix, StoreKit tests run by their own script), so flow-file accepts YAML in
// it. Every entry says why (a reviewer reads it).
export const CONTRACT_ENTRY_FIELDS = {
  extraE2eFolders: { folder: 'string', why: 'string' },
  publishedAppIds: { id: 'string', platform: ['ios', 'android', 'both'], why: 'string' },
  publishedSlugs: { slug: 'string', why: 'string' },
  publishedProductIds: { id: 'string', why: 'string' },
};
// Folders Maestro and flow-file already give a meaning to: an extra folder is never one of them.
const RESERVED_E2E_FOLDERS = ['flows', 'subflows'];

const DEFAULT_CONTRACT = Object.freeze({
  pathHeader: true,
  slugMatchesAppFolder: false,
  locales: null,
  keyAreas: null,
  allowedIndexFiles: [],
  nodeCode: [],
  extraTestIdRoles: [],
  extraE2eFolders: [],
  canonical: { types: [], npmScripts: [], envVars: [] },
  storeProductIds: [],
  publishedAppIds: [],
  publishedSlugs: [],
  publishedProductIds: [],
});

const contractFix = (file) => `Fix ${file} to match the skill's assets/naming-contract.schema.json (copy templates/contracts/naming.json and edit the values).`;

function isStringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '');
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Throws when an entry of an object list is not an object with exactly its fields, each a non-empty string (or one of the allowed values). */
function checkEntries(file, key, entries) {
  const fields = CONTRACT_ENTRY_FIELDS[key];
  const shape = Object.entries(fields).map(([name, type]) => `"${name}": ${Array.isArray(type) ? type.map((v) => `"${v}"`).join(' | ') : '"..."'}`).join(', ');
  entries.forEach((entry, index) => {
    const where = `${file} "${key}"[${index}]`;
    if (!isObject(entry)) throw new UsageError(`${where} must be an object { ${shape} }`, contractFix(file));
    for (const name of Object.keys(entry)) if (!(name in fields)) throw new UsageError(`${where} has the unknown key "${name}"`, contractFix(file));
    for (const [name, type] of Object.entries(fields)) {
      const value = entry[name];
      if (typeof value !== 'string' || value.trim() === '') throw new UsageError(`${where} needs "${name}" (a non-empty string)`, contractFix(file));
      if (Array.isArray(type) && !type.includes(value)) throw new UsageError(`${where} "${name}" must be one of ${type.join(', ')}`, contractFix(file));
    }
    if (key === 'extraE2eFolders') {
      const parts = entry.folder.split('/');
      if (!parts.every((part) => KEBAB.test(part)) || RESERVED_E2E_FOLDERS.includes(parts[0])) {
        throw new UsageError(`${where} "folder" must be a kebab-case folder inside the e2e folder, other than ${RESERVED_E2E_FOLDERS.join(' and ')} (for example "screenshots")`, contractFix(file));
      }
    }
  });
}

/** Reads and validates contracts/naming.json; null when the repo has none (defaults apply). */
export function readContract(root, file) {
  const abs = join(root, file);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${file} is not valid JSON (${error.message})`, contractFix(file));
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new UsageError(`${file} must hold one JSON object`, contractFix(file));
  for (const [key, value] of Object.entries(data)) {
    const type = CONTRACT_KEYS[key];
    if (type === undefined) throw new UsageError(`${file} has the unknown key "${key}"`, contractFix(file));
    const ok = type === 'string[]' ? isStringList(value) : type === 'object[]' ? Array.isArray(value) : type === 'object' ? isObject(value) : typeof value === type;
    if (!ok) throw new UsageError(`${file} "${key}" must be ${type === 'string[]' ? 'a list of non-empty strings' : type === 'object[]' ? 'a list of objects' : `a ${type}`}`, contractFix(file));
    if (type === 'object[]') checkEntries(file, key, value);
  }
  for (const [key, value] of Object.entries(data.canonical ?? {})) {
    if (!CANONICAL_KEYS.includes(key)) throw new UsageError(`${file} "canonical" has the unknown key "${key}"`, contractFix(file));
    if (!isStringList(value)) throw new UsageError(`${file} "canonical.${key}" must be a list of non-empty strings`, contractFix(file));
  }
  for (const locale of data.locales ?? []) if (!LOCALE_TAG.test(locale)) throw new UsageError(`${file} locale "${locale}" is not a BCP 47 tag (en, ar, pt-BR, zh-Hans)`, contractFix(file));
  for (const area of data.keyAreas ?? []) if (!KEBAB.test(area)) throw new UsageError(`${file} key area "${area}" is not kebab-case`, contractFix(file));
  for (const rel of data.allowedIndexFiles ?? []) {
    if (rel.startsWith('/') || rel.split('/').includes('..')) throw new UsageError(`${file} allowedIndexFiles entry "${rel}" is not repo-relative`, contractFix(file));
  }
  return { text, contract: { ...DEFAULT_CONTRACT, ...data, canonical: { ...DEFAULT_CONTRACT.canonical, ...(data.canonical ?? {}) } } };
}

/** 1-based line of the first JSON string "<value>" in text, or 1 (a finding about the file as a whole). */
export function jsonLineOf(text, value) {
  const index = text.indexOf(JSON.stringify(value));
  return index === -1 ? 1 : text.slice(0, index).split('\n').length;
}

/** The layout keys of app code: src/ and the role folders a config may move out of it (app/ routes). */
const APP_CODE_KEYS = ['srcDir', 'routesDir', 'featuresDir', 'uiDir', 'themeDir', 'coreDir', 'servicesDir', 'storesDir', 'dataDir', 'apiDir', 'i18nDir', 'configDir'];

const under = (rel, dir) => dir === '.' || dir === '' || rel === dir || rel.startsWith(`${dir}/`);
const prefixed = (dir, rel) => (dir === '.' ? rel : `${dir}/${rel}`);

/** The scan context: layout, contract and the questions every rule asks about a path. */
export function namingContext(root, { contract: contractOption } = {}) {
  const layout = resolveLayout(root);
  const configured = typeof layout.config.namingContract === 'string' ? layout.config.namingContract : null;
  const given = contractOption ?? configured ?? `${layout.contractsDir}/${CONTRACT_NAME}`;
  // Relative paths are relative to the repo root; an absolute --contract is shown relative to it.
  const contractFile = toPosix(isAbsolute(given) ? relative(root, given) : given).replace(/^\.\//, '');
  const named = contractOption !== undefined ? '--contract' : configured !== null ? 'rn-skills.config.json "namingContract"' : null;
  if (named !== null && !existsSync(join(root, contractFile))) {
    throw new UsageError(`${named} names ${contractFile}, which does not exist`, `Fix the path, or copy the skill's templates/contracts/naming.json to ${contractFile}; without the option the checkers read ${layout.contractsDir}/${CONTRACT_NAME}.`);
  }
  const read = readContract(root, contractFile);
  const contract = read?.contract ?? null;
  const apps = [{ dir: '.', name: '', layout, isRoot: true }, ...layout.workspaces.map((ws) => ({ dir: ws.dir, name: ws.name, layout: ws.layout, isRoot: false }))];
  for (const app of apps) app.isExpoApp = isExpoApp(root, app.dir);

  // The role folders of every app are roots: their own names are the layout's (.maestro, __mocks__),
  // not names the kebab-case rules judge; in a multi-package repo each workspace has its own set.
  const ROOT_KEYS = [...APP_CODE_KEYS, 'testDir', 'scriptsDir', 'mocksDir', 'e2eDir', 'contractsDir'];
  const ownedRoots = new Set(ROOT_KEYS.map((key) => layout[key]));
  ownedRoots.add('plugins');
  for (const ws of layout.workspaces) {
    ownedRoots.add(ws.dir);
    for (const key of ROOT_KEYS) if (typeof ws.layout[key] === 'string') ownedRoots.add(ws.layout[key]);
    ownedRoots.add(prefixed(ws.dir, 'plugins'));
  }

  const nodeGlobs = (contract ?? DEFAULT_CONTRACT).nodeCode;
  const appOf = (rel) => {
    let best = apps[0];
    for (const app of apps.slice(1)) if (under(rel, app.dir) && app.dir.length > (best.isRoot ? 0 : best.dir.length)) best = app;
    return best;
  };
  const roleOf = (rel, key) => {
    const app = appOf(rel);
    return under(rel, app.layout[key]) ? app.layout[key] : null;
  };
  const isTest = (rel) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.split('/').includes('__tests__');
  const isNodeCode = (rel) => {
    const app = appOf(rel);
    const local = app.isRoot ? rel : rel.slice(app.dir.length + 1);
    if (/^app\.config\.[cm]?[jt]s$/.test(local) || !local.includes('/')) return true;
    if (under(rel, prefixed(app.dir, 'plugins'))) return true;
    if (['scriptsDir', 'testDir', 'mocksDir'].some((key) => under(rel, app.layout[key]) || under(rel, layout[key]))) return true;
    if (isTest(rel)) return true;
    return nodeGlobs.some((glob) => matchGlob(rel, glob));
  };
  // Server code runs in Expo's server runtime, never in the app bundle: Expo Router API routes
  // (<name>+api.ts) and middleware (+middleware.ts) in a routes folder, and the src/server/ folder of
  // helpers they share (Expo's documented layout). It may read any variable (secrets included).
  const isServerCode = (rel) => {
    const app = appOf(rel);
    if (under(rel, prefixed(app.layout.srcDir, 'server'))) return true;
    return roleOf(rel, 'routesDir') !== null && /(^|\/)(\+middleware|[^/]*\+api)\.[cm]?[jt]sx?$/.test(rel);
  };
  const isAppCode = (rel) => APP_CODE_KEYS.some((key) => roleOf(rel, key) !== null);
  const isRuntime = (rel) => isAppCode(rel) && !isNodeCode(rel) && !isServerCode(rel);
  const effective = contract ?? DEFAULT_CONTRACT;
  const isPublishedAppId = (id, platform) => effective.publishedAppIds.some((entry) => entry.id === id && (platform === undefined || entry.platform === 'both' || entry.platform === platform));
  // Tooling talks to external formats (App Store Connect, Gradle, Maestro): its kind/type values and
  // strings follow those formats, so the testID, kind and key rules leave it alone. Root mocks
  // mirror vendor SDKs the same way.
  const isTooling = (rel) => {
    const app = appOf(rel);
    const local = app.isRoot ? rel : rel.slice(app.dir.length + 1);
    if (!local.includes('/') || under(rel, prefixed(app.dir, 'plugins'))) return true;
    if (['scriptsDir', 'mocksDir'].some((key) => under(rel, app.layout[key]) || under(rel, layout[key]))) return true;
    return nodeGlobs.some((glob) => matchGlob(rel, glob));
  };
  const isOwned = (rel) => [...ownedRoots].some((dir) => under(rel, dir) && dir !== '.' && dir !== '');

  return {
    root,
    layout,
    contract: contract ?? DEFAULT_CONTRACT,
    hasContract: contract !== null,
    contractFile,
    contractLine: (value) => (read === null ? 1 : jsonLineOf(read.text, value)),
    apps,
    ownedRoots: [...ownedRoots],
    isOwned,
    roleOf,
    appOf,
    isNodeCode,
    isServerCode,
    isAppCode,
    isRuntime,
    isPublishedAppId,
    isPublishedSlug: (slug) => effective.publishedSlugs.some((entry) => entry.slug === slug),
    isPublishedProductId: (id) => effective.publishedProductIds.some((entry) => entry.id === id),
    isTooling,
    isTest,
    testIdRoles: [...RULES.testIdRoles, ...(contract ?? DEFAULT_CONTRACT).extraTestIdRoles],
  };
}

/** The note both checkers print when the default contract file is missing (library defaults apply), or null. */
export function missingContractNote(ctx) {
  return ctx.hasContract ? null : `note: ${ctx.contractFile} not found; library defaults apply (copy templates/contracts/naming.json to declare locales, key areas, canonical names and product ids)`;
}

export { under, prefixed };
