// architecture.mjs: the app's architecture as data, shared by check-boundaries.mjs and check-layout.mjs.
// It merges the skill's defaults (assets/architecture-defaults.json) with the app's optional contract
// (contracts/architecture.json), resolves every folder through check-lib's resolveLayout (so
// rn-skills.config.json can move them), and puts each repo file into one zone. It also reads two keys
// other skills own: rn-skills.config.json devOnlyRequires (app-variants-and-environment) and
// contracts/dependency-policy.json doNotAdd (dependency-management), so each list has one home.
//
//   const arch = loadArchitecture(root, { contract, overrides });
//   arch.classify('src/features/tasks/tasks-screen.tsx')
//     -> { zone: 'features', feature: 'tasks', isTest: false, isBundled: true, isRuntime: true, ... }
//   arch.sdkClass('expo-notifications') -> 'vendor' | 'portless' | 'unclassified' | null (not an SDK name)
//
// Zones of an app (single app, or each apps/<name> workspace): routes, features, ui, theme, core,
// services, stores, data, api, i18n, config, games, src (anything else under src/), server (Expo Router
// API routes, the root +middleware file and contract serverFiles: server code, never in the native
// bundle), node (app.config.ts, plugins/, scripts/ and contract nodeWorldFiles), test-helpers (test/),
// mocks (__mocks__/), native-module (local Expo modules in modules/<name>/). A workspace under
// packages/ is zone 'package' (pure or Node world when the contract says so).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError, globToRegExp, matchGlob, parseJsonc, resolveLayout } from '../check-lib.mjs';

// lib/ -> scripts/ -> the skill folder, which holds assets/.
const SKILL_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DEFAULTS = JSON.parse(readFileSync(join(SKILL_DIR, 'assets', 'architecture-defaults.json'), 'utf8'));

export const CONTRACT_FILE = 'architecture.json';

/** Every key contracts/architecture.json may hold, with its JSON type. */
export const CONTRACT_KEYS = Object.freeze({
  $schema: 'string',
  $comment: 'string',
  srcFolders: 'string[]',
  sdkPackagePatterns: 'string[]',
  vendorSdks: 'map',
  vendorSdkFiles: 'map',
  portlessSdks: 'map',
  bannedPackages: 'map',
  adapterFiles: 'string[]',
  compositionRoot: 'string[]',
  nodeWorldFiles: 'string[]',
  serverFiles: 'string[]',
  allowedImports: 'object[]',
  nonFeatureScreens: 'string[]',
  testOnlyFolders: 'string[]',
  importTimeExempt: 'string[]',
  gameFacing: 'string[]',
  assetExtensions: 'string[]',
  packages: 'object[]',
});

/** Zones that sit below features: they never import a feature. */
export const SHARED_ZONES = Object.freeze(new Set(['ui', 'theme', 'services', 'stores', 'data', 'api', 'i18n', 'config', 'src', 'games']));
/** Zones of code Metro bundles into the app (tests next to it included). */
const SRC_ZONES = new Set(['routes', 'features', 'ui', 'theme', 'core', 'services', 'stores', 'data', 'api', 'i18n', 'config', 'games', 'src']);
const LAYOUT_DIR_ZONES = [
  ['routesDir', 'routes'],
  ['featuresDir', 'features'],
  ['uiDir', 'ui'],
  ['themeDir', 'theme'],
  ['coreDir', 'core'],
  ['servicesDir', 'services'],
  ['storesDir', 'stores'],
  ['dataDir', 'data'],
  ['apiDir', 'api'],
  ['i18nDir', 'i18n'],
  ['configDir', 'config'],
];
const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/;

export const under = (rel, dir) => dir !== '' && dir !== '.' && (rel === dir || rel.startsWith(`${dir}/`));
const prefixed = (dir, rel) => (dir === '' || dir === '.' ? rel : `${dir}/${rel}`);

/** True when an npm package name matches a list entry ('react', 'expo-*', '@react-native/*'). */
export function nameMatches(name, pattern) {
  return pattern.includes('*') ? globToRegExp(pattern).test(name) : name === pattern;
}

/** The npm package name of a bare specifier: 'expo-sqlite/kv-store' -> 'expo-sqlite'. */
export function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** A glob as a person reads it: the platform-suffix and extension braces of the defaults left out. */
export function readableGlob(glob) {
  return glob.replace('{,.ios,.android,.native,.web}', '').replace(/\.\{ts,tsx(,js,jsx)?\}/, '.ts');
}

function fillPlaceholders(glob, layout) {
  return glob.replace(/\{(\w+)\}/g, (whole, key) => (typeof layout[key] === 'string' ? layout[key] : whole));
}

function contractProblem(file, message) {
  return new UsageError(`${file}: ${message}`, `Fix ${file} (the keys and shapes are in the skill's templates/contracts/architecture.schema.json).`);
}

function checkContractShape(data, file) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw contractProblem(file, 'must hold one JSON object');
  for (const [key, value] of Object.entries(data)) {
    const type = CONTRACT_KEYS[key];
    if (!type) throw contractProblem(file, `unknown key "${key}" (known: ${Object.keys(CONTRACT_KEYS).filter((k) => !k.startsWith('$')).join(', ')})`);
    const isList = Array.isArray(value);
    if (type === 'string' && typeof value !== 'string') throw contractProblem(file, `"${key}" must be a string`);
    if (type === 'string[]' && !(isList && value.every((item) => typeof item === 'string' && item.trim() !== ''))) throw contractProblem(file, `"${key}" must be a list of non-empty strings`);
    if (type === 'object[]' && !(isList && value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)))) throw contractProblem(file, `"${key}" must be a list of objects`);
    if (type === 'map' && (value === null || typeof value !== 'object' || isList)) throw contractProblem(file, `"${key}" must be an object`);
  }
  for (const [index, entry] of (data.allowedImports ?? []).entries()) {
    for (const field of ['from', 'to', 'reason']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') throw contractProblem(file, `allowedImports[${index}].${field} must be a non-empty string (every exception records its reason)`);
    }
  }
  for (const [index, entry] of (data.packages ?? []).entries()) {
    if (typeof entry.name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.name)) throw contractProblem(file, `packages[${index}].name must be the kebab-case folder name under packages/`);
    if (entry.pure !== undefined && typeof entry.pure !== 'boolean') throw contractProblem(file, `packages[${index}].pure must be true or false`);
    if (entry.world !== undefined && !['node', 'app'].includes(entry.world)) throw contractProblem(file, `packages[${index}].world must be "node" or "app"`);
    if (entry.exports !== undefined && (entry.exports === null || typeof entry.exports !== 'object' || Array.isArray(entry.exports))) throw contractProblem(file, `packages[${index}].exports must be an object`);
  }
  for (const key of ['vendorSdks', 'bannedPackages', 'portlessSdks']) {
    for (const [name, value] of Object.entries(data[key] ?? {})) {
      if (value !== null && (typeof value !== 'string' || value.trim() === '')) throw contractProblem(file, `${key}."${name}" must be a non-empty string, or null to drop a default`);
    }
  }
  for (const [index, ext] of (data.assetExtensions ?? []).entries()) {
    if (!/^[a-z0-9]+$/.test(ext)) throw contractProblem(file, `assetExtensions[${index}] must be a lowercase extension without the dot ("glb", not ".glb"), the same as metro.config.js resolver.assetExts`);
  }
  for (const [index, pattern] of (data.sdkPackagePatterns ?? []).entries()) {
    if (!/^(@[a-z0-9*~._-]+\/)?[a-z0-9*~._-]+$/.test(pattern)) throw contractProblem(file, `sdkPackagePatterns[${index}] must be an npm package name or a name glob such as "*-sdk" or "@acme/*"`);
  }
  for (const [name, value] of Object.entries(data.vendorSdkFiles ?? {})) {
    if (value !== null && !(Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string'))) throw contractProblem(file, `vendorSdkFiles."${name}" must be a list of globs, or null to drop a default`);
  }
}

/** The contract, or null when the app has none. An explicit --contract path must exist. */
function readContract(root, layout, given) {
  const rel = given ?? posix.join(layout.contractsDir, CONTRACT_FILE);
  const path = join(root, rel);
  if (!existsSync(path)) {
    if (given) throw new UsageError(`nothing to check: the contract ${rel} does not exist`, 'Pass the path of contracts/architecture.json, or leave --contract out to use the defaults.');
    return { rel, data: null };
  }
  let data;
  try {
    data = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    throw contractProblem(rel, `is not valid JSON (${error.message})`);
  }
  checkContractShape(data, rel);
  return { rel, data };
}

/** defaults + contract for a map: a contract value of null removes a default entry. */
function mergeMap(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

export const POLICY_FILE = 'dependency-policy.json';

/**
 * dependency-management's install policy: { rel, doNotAdd: { package: reason }, note }. Its doNotAdd
 * map joins bannedPackages, so the developer keeps one list. A missing file is fine; a malformed one is
 * that skill's checker's to report, so here it only yields a note.
 */
function readPolicy(root, layout) {
  const rel = posix.join(layout.contractsDir, POLICY_FILE);
  const path = join(root, rel);
  if (!existsSync(path)) return { rel, doNotAdd: {}, note: null };
  try {
    const data = parseJsonc(readFileSync(path, 'utf8'));
    const map = data?.doNotAdd;
    if (map === undefined) return { rel, doNotAdd: {}, note: null };
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return { rel, doNotAdd: {}, note: `note: ${rel} doNotAdd is not an object; its packages are not banned here` };
    const doNotAdd = Object.fromEntries(Object.entries(map).filter(([, reason]) => typeof reason === 'string' && reason.trim() !== ''));
    return { rel, doNotAdd, note: null };
  } catch (error) {
    return { rel, doNotAdd: {}, note: `note: ${rel} is not valid JSON (${error.message}); its doNotAdd packages are not banned here` };
  }
}

/** rn-skills.config.json devOnlyRequires (app-variants-and-environment documents it): require() specifier globs. */
function readDevOnlyRequires(layout) {
  const list = layout.config?.devOnlyRequires;
  if (list === undefined) return [];
  if (!Array.isArray(list) || !list.every((glob) => typeof glob === 'string' && glob.trim() !== '')) {
    throw new UsageError('rn-skills.config.json: "devOnlyRequires" must be a list of require() specifier globs', 'Write "devOnlyRequires": ["./dev-tools/*"] (app-variants-and-environment documents the key).');
  }
  return list;
}

function readManifest(root, dir) {
  try {
    return JSON.parse(readFileSync(join(root, dir === '' ? 'package.json' : `${dir}/package.json`), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Loads the architecture of the repo at `root`.
 * options.contract: a repo-relative contract path (default <contractsDir>/architecture.json)
 * options.overrides: resolveLayout overrides ({ srcDir, routesDir })
 */
export function loadArchitecture(root, options = {}) {
  const layout = resolveLayout(root, options.overrides ?? {});
  const contract = readContract(root, layout, options.contract);
  const c = contract.data ?? {};
  const policy = readPolicy(root, layout);
  const notes = policy.note ? [policy.note] : [];
  // Where each ban comes from, for the fix text: the defaults, the install policy, or the contract.
  const bannedSources = {};
  for (const name of Object.keys(DEFAULTS.bannedPackages)) bannedSources[name] = 'default';
  for (const name of Object.keys(policy.doNotAdd)) bannedSources[name] = 'policy';
  for (const [name, value] of Object.entries(c.bannedPackages ?? {})) if (value !== null) bannedSources[name] = 'contract';
  const settings = {
    srcFolders: [...new Set([...DEFAULTS.srcFolders, ...(c.srcFolders ?? [])])],
    srcFiles: DEFAULTS.srcFiles,
    frameworkPackages: DEFAULTS.frameworkPackages,
    runtimePackages: DEFAULTS.runtimePackages,
    nodeSafeExpoSubpaths: DEFAULTS.nodeSafeExpoSubpaths,
    vendorSdks: mergeMap(DEFAULTS.vendorSdks, c.vendorSdks),
    vendorSdkFiles: mergeMap(DEFAULTS.vendorSdkFiles, c.vendorSdkFiles),
    portlessSdks: mergeMap(DEFAULTS.portlessSdks, c.portlessSdks),
    sdkPackagePatterns: [...new Set([...DEFAULTS.sdkPackagePatterns, ...(c.sdkPackagePatterns ?? [])])],
    serverPackages: DEFAULTS.serverPackages,
    bannedPackages: mergeMap(mergeMap(DEFAULTS.bannedPackages, policy.doNotAdd), c.bannedPackages),
    bannedSources,
    policyFile: policy.rel,
    nodeWorldMarkers: DEFAULTS.nodeWorldMarkers,
    testOnlyVariable: DEFAULTS.testOnlyVariable,
    devOnlyRequires: readDevOnlyRequires(layout),
    assetExtensions: [...new Set([...DEFAULTS.assetExtensions, ...(c.assetExtensions ?? [])])],
    allowedImports: c.allowedImports ?? [],
    nonFeatureScreens: c.nonFeatureScreens ?? [],
    testOnlyFolders: c.testOnlyFolders ?? [],
    importTimeExempt: c.importTimeExempt ?? [],
    packages: c.packages ?? [],
  };
  // Repo-relative contract globs, with layout placeholders filled from the root layout.
  const contractGlobs = (key) => (c[key] ?? []).map((glob) => fillPlaceholders(glob, layout));

  // Apps: the root (single app) or every workspace under apps/ (or any Expo workspace outside packages/).
  const workspaces = layout.workspaces.map((ws) => ({ ...ws, manifest: readManifest(root, ws.dir) }));
  const appScopes = [];
  const packageScopes = [];
  const appFrom = (dir, appLayout, manifest) => {
    const defaultsFor = (key) => DEFAULTS[key].map((glob) => (glob.includes('{') ? fillPlaceholders(glob, appLayout) : prefixed(dir, glob)));
    // Autolinking reads package.json expo.autolinking.nativeModulesDir, relative to the app (default ./modules).
    const modulesSetting = manifest?.expo?.autolinking?.nativeModulesDir;
    const modulesDir = typeof modulesSetting === 'string' && modulesSetting.trim() !== '' ? modulesSetting : DEFAULTS.nativeModulesDir;
    return {
      kind: 'app',
      dir,
      layout: appLayout,
      manifest,
      nativeModulesDir: posix.normalize(prefixed(dir, modulesDir.replace(/^\.\//, '').replace(/\/$/, ''))),
      adapterGlobs: [...defaultsFor('adapterFiles'), ...contractGlobs('adapterFiles')],
      compositionGlobs: [...defaultsFor('compositionRoot'), ...contractGlobs('compositionRoot')],
      nodeGlobs: [...defaultsFor('nodeWorldFiles'), ...contractGlobs('nodeWorldFiles')],
      // Expo Router's own server files (anywhere under the routes folder) and the contract's server helpers.
      routeServerGlobs: defaultsFor('serverFiles'),
      serverGlobs: contractGlobs('serverFiles'),
      gameFacingGlobs: [...defaultsFor('gameFacing'), ...contractGlobs('gameFacing')],
      vendorFileGlobs: Object.fromEntries(Object.entries(settings.vendorSdkFiles).map(([name, globs]) => [name, globs.map((glob) => (glob.includes('{') ? fillPlaceholders(glob, appLayout) : glob))])),
    };
  };
  if (layout.mode === 'single') {
    appScopes.push(appFrom('', layout, readManifest(root, '')));
  } else {
    for (const ws of workspaces) {
      if (ws.dir.startsWith('packages/')) {
        const name = ws.dir.split('/')[1];
        const declared = settings.packages.find((entry) => entry.name === name) ?? null;
        const pkgLayout = { ...ws.layout, srcDir: `${ws.dir}/src`, servicesDir: `${ws.dir}/src/services`, dataDir: `${ws.dir}/src/data` };
        packageScopes.push({
          kind: 'package',
          dir: ws.dir,
          name,
          packageName: ws.name,
          manifest: ws.manifest,
          declared,
          isPure: declared?.pure === true,
          isNode: declared?.world === 'node',
          layout: ws.layout,
          adapterGlobs: DEFAULTS.adapterFiles.map((glob) => fillPlaceholders(glob, pkgLayout)),
          compositionGlobs: [],
          nodeGlobs: [],
          vendorFileGlobs: Object.fromEntries(Object.entries(settings.vendorSdkFiles).map(([name2, globs]) => [name2, globs.map((glob) => (glob.includes('{') ? fillPlaceholders(glob, pkgLayout) : glob))])),
        });
      } else {
        appScopes.push(appFrom(ws.dir, ws.layout, ws.manifest));
      }
    }
  }
  const rootManifest = readManifest(root, '');
  const rootScope = { kind: 'root', dir: '', layout, nodeGlobs: [prefixed('', 'plugins/**'), `${layout.scriptsDir}/**`, ...contractGlobs('nodeWorldFiles')] };

  const scopeOf = (rel) => {
    let best = null;
    for (const scope of [...appScopes, ...packageScopes]) {
      if (scope.dir === '') {
        best ??= scope;
      } else if (under(rel, scope.dir) && (best === null || best.dir === '' || scope.dir.length > best.dir.length)) {
        best = scope;
      }
    }
    return best ?? rootScope;
  };

  const anyGlob = (rel, globs) => globs.some((glob) => matchGlob(rel, glob));
  const cache = new Map();
  /**
   * Server code: an Expo Router +api file or the root +middleware file, or a contract serverFiles glob
   * outside the routes folder (anything else in the routes folder ships in the native bundle as a route).
   */
  const isServerPath = (scope, rel) => {
    if (anyGlob(rel, scope.routeServerGlobs ?? [])) return true;
    return !under(rel, scope.layout.routesDir) && anyGlob(rel, scope.serverGlobs ?? []);
  };

  /** The zone record of one repo-relative posix path. */
  const classify = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    const scope = scopeOf(rel);
    const info = { rel, scope, zone: 'outside', feature: null, game: null, gamePart: null, module: null, isTest: TEST_NAME.test(rel), isNode: false, isPure: false };
    const L = scope.layout;
    if (scope.kind === 'package') {
      info.zone = 'package';
      info.isNode = scope.isNode;
      info.isPure = scope.isPure;
    } else {
      const appRoot = scope.dir;
      if (scope.nodeGlobs && anyGlob(rel, scope.nodeGlobs)) {
        info.zone = 'node';
        info.isNode = true;
      } else if (scope.kind === 'app' && isServerPath(scope, rel)) {
        info.zone = 'server';
      } else if (scope.kind === 'app' && under(rel, scope.nativeModulesDir)) {
        info.zone = 'native-module';
        info.module = rel.slice(scope.nativeModulesDir.length + 1).split('/')[0];
      } else if (under(rel, L.testDir)) {
        info.zone = 'test-helpers';
        info.isTest = true;
      } else if (under(rel, L.mocksDir)) {
        info.zone = 'mocks';
        info.isTest = true;
      } else if (rel === prefixed(appRoot, 'jest.setup.ts')) {
        info.zone = 'test-helpers';
        info.isTest = true;
      } else if (scope.kind === 'app') {
        for (const [key, zone] of LAYOUT_DIR_ZONES) {
          if (under(rel, L[key])) {
            info.zone = zone;
            if (zone === 'features') info.feature = rel.slice(L[key].length + 1).split('/')[0] ?? null;
            break;
          }
        }
        if (info.zone === 'outside' && under(rel, `${L.srcDir}/games`)) {
          const inGames = rel.slice(`${L.srcDir}/games/`.length);
          const [game, part] = inGames.split('/');
          info.zone = 'games';
          // A file directly in src/games/ (a registry, a shared type) belongs to no game.
          info.game = inGames.includes('/') ? game : null;
          info.gamePart = part !== undefined && rel.slice(`${L.srcDir}/games/${game}/`.length).includes('/') ? part : null;
        }
        if (info.zone === 'outside' && under(rel, L.srcDir)) info.zone = 'src';
      }
      if (info.zone === 'core') info.isPure = true;
      if (info.zone === 'games' && ['rules', 'levels'].includes(info.gamePart)) info.isPure = true;
    }
    info.isBundled = SRC_ZONES.has(info.zone) || (info.zone === 'package' && !info.isNode);
    info.isRuntime = info.isBundled && !info.isTest;
    info.isTooling = ['test-helpers', 'mocks'].includes(info.zone) || (info.zone === 'node' && scope.layout && under(rel, scope.layout.scriptsDir)) || (info.zone === 'package' && info.isNode);
    cache.set(rel, info);
    return info;
  };

  /** Folders whose TypeScript files are this architecture's code (pre-existing folders are left alone). */
  const codeRoots = new Set();
  for (const scope of [...appScopes, rootScope]) {
    const L = scope.layout;
    for (const key of ['srcDir', 'routesDir', 'testDir', 'mocksDir', 'scriptsDir']) codeRoots.add(L[key]);
    codeRoots.add(prefixed(scope.dir, 'plugins'));
  }
  for (const scope of [...appScopes, ...packageScopes]) if (scope.dir !== '') codeRoots.add(scope.dir);
  const isCodePath = (rel) => !rel.includes('/') || [...codeRoots].some((dir) => under(rel, dir));

  const isAdapter = (rel) => {
    const scope = scopeOf(rel);
    return !TEST_NAME.test(rel) && anyGlob(rel, scope.adapterGlobs ?? []);
  };
  const isCompositionRoot = (rel) => anyGlob(rel, scopeOf(rel).compositionGlobs ?? []);
  const isPortFile = (rel) => /-port\.tsx?$/.test(rel);
  const isLayoutRoute = (rel) => /(^|\/)_layout\.[cm]?[jt]sx?$/.test(rel);
  /** The root layout of the file's app: <routesDir>/_layout.tsx (it mounts the composition root). */
  const isRootLayout = (rel) => {
    const scope = scopeOf(rel);
    const routes = scope.layout?.routesDir;
    return scope.kind === 'app' && under(rel, routes) && /^_layout\.[cm]?[jt]sx?$/.test(rel.slice(routes.length + 1));
  };
  /** createDeviceServices(): every call builds fresh adapters, so only the root layout calls it. */
  const isDeviceServicesFactory = (rel) => /^create-device-services\.tsx?$/.test(basename(rel)) && isCompositionRoot(rel);
  /** createTestServices(): test code like a fake. */
  const isTestServicesFactory = (rel) => /^create-test-[a-z0-9-]*\.tsx?$/.test(basename(rel)) && isCompositionRoot(rel) && !TEST_NAME.test(rel);
  const vendorFilesFor = (rel, name) => scopeOf(rel).vendorFileGlobs?.[name] ?? null;
  const isAllowed = (fromRel, toRel) => settings.allowedImports.some((entry) => matchGlob(fromRel, entry.from) && matchGlob(toRel, entry.to));
  // A package built on React (react or react-native in its dependencies or peer dependencies) is a
  // framework package whatever its name (react-i18next, jotai, a state library): read only when
  // node_modules exists, beside the name list.
  const reactCache = new Map();
  const buildsOnReact = (fromRel, name) => {
    for (const dir of new Set([scopeOf(fromRel).dir, ''])) {
      const manifestPath = join(root, dir, 'node_modules', name, 'package.json');
      if (reactCache.has(manifestPath)) return reactCache.get(manifestPath);
      if (!existsSync(manifestPath)) continue;
      let manifest = null;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        manifest = null;
      }
      const fields = ['dependencies', 'peerDependencies'];
      const result = fields.some((field) => ['react', 'react-native'].some((dep) => manifest?.[field]?.[dep] !== undefined));
      reactCache.set(manifestPath, result);
      return result;
    }
    return false;
  };
  const isFramework = (name, fromRel = '') => settings.frameworkPackages.some((pattern) => nameMatches(name, pattern)) || buildsOnReact(fromRel, name);
  const isRuntimePackage = (spec) => {
    const name = packageName(spec);
    if (name === 'expo') return !settings.nodeSafeExpoSubpaths.some((safe) => spec === safe || spec.startsWith(`${safe}/`));
    return settings.runtimePackages.some((pattern) => nameMatches(name, pattern));
  };
  const aliasesFor = (rel) => {
    const scope = scopeOf(rel);
    return scope.layout?.aliases?.length > 0 ? scope.layout.aliases : layout.aliases;
  };
  const isTestOnlyGate = (rel) => basename(rel) === 'test-only.ts';
  const isTestOnlyEntry = (rel) => /^test-only-entry\.tsx?$/.test(basename(rel));
  const testOnlyGlobs = settings.testOnlyFolders.map((dir) => (dir.endsWith('**') ? dir : `${dir.replace(/\/$/, '')}/**`));
  /** A file in a contract testOnlyFolders folder: reached only through the test-only entry. */
  const isInTestOnlyFolder = (rel) => anyGlob(rel, testOnlyGlobs);
  /** An in-memory fake (fake-<concern>.ts), not its test. */
  const isFake = (rel) => /^fake-[a-z0-9-]+\.tsx?$/.test(basename(rel)) && !TEST_NAME.test(rel);
  const assetPattern = new RegExp(`\\.(${settings.assetExtensions.join('|')})$`, 'i');
  /** A specifier that names a Metro asset (an image, font, sound, video or database file). */
  const isAssetSpec = (spec) => assetPattern.test(spec);
  /** May server code import this package specifier? Runtime modules (React Native, Expo) are not server code. */
  const isServerPackage = (spec) => settings.serverPackages.some((safe) => spec === safe || spec.startsWith(`${safe}/`));

  // Local Expo modules imported by a package name (modules/<name>/package.json), per app scope.
  const localModuleNames = new Map();
  for (const scope of appScopes) {
    const dir = join(root, scope.nativeModulesDir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = readManifest(root, `${scope.nativeModulesDir}/${entry.name}`)?.name;
      if (typeof name === 'string') localModuleNames.set(`${scope.dir}\0${name}`, `${scope.nativeModulesDir}/${entry.name}`);
    }
  }
  /** The folder of the local Expo module a bare package name names, from the importer's app, or null. */
  const localModuleOf = (fromRel, name) => localModuleNames.get(`${scopeOf(fromRel).dir}\0${name}`) ?? null;

  // A package that ships native code is an SDK whatever its name (read only when node_modules exists).
  const NATIVE_FRAMEWORK = new Set(['react-native', 'expo']);
  const nativeCache = new Map();
  const shipsNativeCode = (fromRel, name) => {
    if (NATIVE_FRAMEWORK.has(name)) return false;
    for (const dir of new Set([scopeOf(fromRel).dir, ''])) {
      const pkgDir = join(root, dir, 'node_modules', name);
      if (nativeCache.has(pkgDir)) return nativeCache.get(pkgDir);
      if (!existsSync(join(pkgDir, 'package.json'))) continue;
      let entries = [];
      try {
        entries = readdirSync(pkgDir);
      } catch {
        entries = [];
      }
      const native =
        entries.includes('expo-module.config.json') ||
        entries.some((file) => file.endsWith('.podspec')) ||
        existsSync(join(pkgDir, 'android', 'build.gradle')) ||
        existsSync(join(pkgDir, 'android', 'build.gradle.kts'));
      nativeCache.set(pkgDir, native);
      return native;
    }
    return false;
  };
  /**
   * How the architecture classifies an SDK package: 'vendor' (behind a port, vendorSdks), 'portless'
   * (any file may import it, portlessSdks), 'local' (a local Expo module, adapter only), 'unclassified'
   * (an SDK with no decision yet: its name matches sdkPackagePatterns, or node_modules shows it ships
   * native code), or null for any other package (react, zustand, valibot, ...).
   */
  const sdkClass = (name, fromRel = '') => {
    if (settings.vendorSdks[name]) return 'vendor';
    if (settings.portlessSdks[name]) return 'portless';
    if (localModuleOf(fromRel, name)) return 'local';
    if (settings.sdkPackagePatterns.some((pattern) => nameMatches(name, pattern))) return 'unclassified';
    return shipsNativeCode(fromRel, name) ? 'unclassified' : null;
  };
  /** May code of a game import this file? Its own game's folder and the scope's gameFacing globs. */
  const isGameFacing = (fromInfo, toRel) => {
    const to = classify(toRel);
    if (to.zone === 'games' && to.game === fromInfo.game) return true;
    return anyGlob(toRel, fromInfo.scope.gameFacingGlobs ?? []);
  };
  /** Does the manifest of the file's workspace (or the root manifest) declare this package? */
  const dependsOn = (rel, name) => {
    const manifests = [scopeOf(rel).manifest, rootManifest];
    return manifests.some((manifest) => ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) => manifest?.[field]?.[name] !== undefined));
  };

  return {
    root,
    layout,
    contract,
    settings,
    notes,
    appScopes,
    packageScopes,
    rootScope,
    scopeOf,
    classify,
    isCodePath,
    isAdapter,
    isCompositionRoot,
    isPortFile,
    isLayoutRoute,
    isRootLayout,
    isDeviceServicesFactory,
    isTestServicesFactory,
    vendorFilesFor,
    isAllowed,
    isFramework,
    isRuntimePackage,
    aliasesFor,
    isTestOnlyGate,
    isTestOnlyEntry,
    isInTestOnlyFolder,
    isFake,
    isAssetSpec,
    isServerPackage,
    localModuleOf,
    sdkClass,
    isGameFacing,
    dependsOn,
    anyGlob,
  };
}
