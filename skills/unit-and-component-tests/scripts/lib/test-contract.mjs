// lib/test-contract.mjs: what check-test-setup.mjs and check-test-code.mjs share. The optional repo
// contract contracts/test-setup.json (the app's own facts: where its logic lives, which extra native
// SDKs need a root mock, where the render and router helpers are, which folders another test runner
// owns), its defaults for the canonical layout, the package manifests, the native SDKs known to crash
// on import in Jest, and the files of the repo that Jest or Expo would treat as tests (both checkers
// scan the same list).

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { fail, maskComments, parseJsonc, readWorkspaces, walkRepo } from '../check-lib.mjs';

export const CONTRACT_FILE = 'test-setup.json';
/** rn-skills.config.json key that points at the contract when it is not contracts/test-setup.json. */
export const CONTRACT_CONFIG_KEY = 'testSetupContract';

/**
 * Native modules that ship no Jest mock and crash on import under jest-expo, so each needs a root
 * manual mock __mocks__/<name>.ts once the app depends on it (verified 2026-10-03, Expo SDK 57).
 * expo-tracking-transparency is here because jest-expo mocks only its native module, whose functions
 * answer undefined, and the package's own JS then crashes on response.status.
 */
export const KNOWN_ROOT_MOCKS = Object.freeze([
  'expo-iap',
  'expo-tracking-transparency',
  'react-native-audio-api',
  'react-native-google-mobile-ads',
  'react-native-keyboard-controller',
]);

export const RENDER_HELPER_FUNCTIONS = Object.freeze(['renderWithProviders', 'renderHookWithProviders', 'createProvidersWrapper']);
export const ROUTER_HELPER_FUNCTIONS = Object.freeze(['renderRouterWithProviders']);

const STRING_LIST = 'a list of strings';
const HELPER = 'an object { "file": "<repo path>", "functions": ["<exported name>", ...] }';
const KEYS = Object.freeze({
  renderHelper: HELPER,
  routerHelper: HELPER,
  deviceOnlyHelper: 'a repo-relative file path',
  rootMocks: STRING_LIST,
  logicCoverageKeys: STRING_LIST,
  mutateGlobs: STRING_LIST,
  styleContractGlobs: STRING_LIST,
  logicTestGlobs: STRING_LIST,
  otherRunnerGlobs: STRING_LIST,
});

const isStringList = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim() !== '');
const isRepoPath = (value) => typeof value === 'string' && value.trim() !== '' && !value.startsWith('/') && !value.split('/').includes('..');

export function readJsonFile(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(`${what} is not valid JSON: ${String(error.message).split('\n')[0]}`, `Fix ${what} first.`);
  }
}

/** The root manifest, every workspace manifest, and the app manifests (the root, or the workspaces that depend on expo). */
export function readManifests(root) {
  const rootPkg = readJsonFile(join(root, 'package.json'), 'package.json');
  const workspaces = readWorkspaces(root).filter((workspace) => workspace.manifest).map((workspace) => ({ rel: `${workspace.dir}/package.json`, dir: workspace.dir, pkg: workspace.manifest }));
  const rootEntry = { rel: 'package.json', dir: '', pkg: rootPkg };
  const apps = workspaces.length > 0 ? workspaces.filter(({ pkg }) => depsOf(pkg).expo !== undefined) : [rootEntry];
  return { root: rootEntry, all: [rootEntry, ...workspaces], apps };
}

export const depsOf = (pkg) => ({ ...pkg?.peerDependencies, ...pkg?.devDependencies, ...pkg?.dependencies });

/** True when the root or any workspace declares the package. */
export const declares = (manifests, name) => manifests.all.some(({ pkg }) => depsOf(pkg)[name] !== undefined);

/** The version an app declares for a package, without ^ ~ =, or null. */
export function appVersion(manifests, name) {
  for (const { pkg } of manifests.apps) {
    const version = depsOf(pkg)[name];
    if (typeof version === 'string' && /\d/.test(version)) return version.replace(/^[\^~=]/, '');
  }
  return null;
}

/** Source folders whose files coverage counts and whose *.test.tsx files are component tests. */
export function sourceRoots(layout) {
  return layout.mode === 'monorepo' ? layout.workspaces.map((workspace) => workspace.layout.srcDir) : [layout.srcDir];
}

/** Folders whose tests the canonical TEST_ROOTS reach: the source folders, the root test/, scripts/ and plugins/ (local Expo config plugins), and each workspace's test/ and plugins/. */
export function testRoots(layout) {
  const roots = new Set([...sourceRoots(layout), layout.testDir, layout.scriptsDir, 'plugins']);
  if (layout.mode === 'monorepo') for (const workspace of layout.workspaces) roots.add(workspace.layout.testDir).add(`${workspace.dir}/plugins`);
  return [...roots];
}

/**
 * How Jest and Expo name tests (verified 2026-10-03): Jest's default testMatch runs every
 * `__tests__/**\/*.[jt]s?(x)` and every `?(*.)+(spec|test).[jt]s?(x)` file; the jest-expo platform
 * presets run `__tests__/**\/*test.[jt]s?(x)` and `*spec`; Expo's unit-testing guide puts tests in a
 * root `__tests__/` folder as `<name>-test.tsx`. A file named like that is a test the app meant to run.
 */
const SOURCE_FILE = /\.[jt]sx?$/;
const NAMED_TEST = /(?:^|\.)(?:spec|test)+\.[jt]sx?$/;
const DASH_TEST = /-test\.[jt]sx?$/;
const IN_TESTS_DIR = /(?:^|\/)__tests__\//;
/** A __tests__/ or *-test file counts only when it holds a test (a helper beside the tests does not). */
const TEST_CALL = /(?<![\w$.])(?:describe|it|test)(?:\s*\.\s*(?:each|only|skip|concurrent|failing|todo))*\s*[(`]/;
const CONFIG_EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];
const configNames = (base) => CONFIG_EXTENSIONS.map((ext) => `${base}.${ext}`);
const PLAYWRIGHT_CONFIGS = configNames('playwright.config');
const CYPRESS_CONFIGS = configNames('cypress.config');
/** A folder holding one of these runs its own tests: Jest, Vitest, Playwright, Cypress, or Deno (supabase/functions/deno.json). */
const OWN_RUNNER_FILES = ['jest.config.json', ...configNames('jest.config'), ...configNames('vitest.config'), ...PLAYWRIGHT_CONFIGS, ...CYPRESS_CONFIGS, 'deno.json', 'deno.jsonc'];

/** True when `dir` (below the root) runs its own tests: its own Jest, Vitest, Playwright, Cypress or Deno config, or a package.json with a jest key or a test script. */
function runsOwnTests(root, dir) {
  if (OWN_RUNNER_FILES.some((name) => existsSync(join(root, dir, name)))) return true;
  const manifest = join(root, dir, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    return pkg.jest !== undefined || typeof pkg.scripts?.test === 'string';
  } catch {
    return false;
  }
}

/** The string literals of `key: '...'` and `key: ['...', ...]` in a config file's code (comments masked). */
function literalValues(code, key) {
  const values = [];
  for (const match of code.matchAll(new RegExp(`\\b${key}\\s*:\\s*(\\[[^\\]]*\\]|['"\`][^'"\`]*['"\`])`, 'g'))) {
    for (const literal of match[1].matchAll(/['"`]([^'"`]+)['"`]/g)) values.push(literal[1]);
  }
  return values;
}

/** The folder part of a glob before its first wildcard ('cypress/e2e/**\/*.spec.ts' -> 'cypress/e2e'). */
function staticFolder(glob) {
  const parts = [];
  for (const part of glob.replace(/^\.\//, '').split('/')) {
    if (/[*?{[]/.test(part)) break;
    parts.push(part);
  }
  return /[*?{[]/.test(glob) ? parts.join('/') : posix.dirname(parts.join('/'));
}

/**
 * Folders that a Playwright or Cypress config at the repo root (or a workspace root) owns: each
 * literal Playwright `testDir`, and Cypress's `cypress/` folder plus the folder of each literal
 * `specPattern`. A config that names no folder (Playwright's testDir defaults to the config's own
 * folder, the whole repo) owns nothing here: the contract's otherRunnerGlobs names the folder then.
 */
function foreignRunnerDirs(root, baseDirs) {
  const dirs = new Set();
  const add = (base, folder) => {
    const rel = posix.normalize(posix.join(base, folder)).replace(/\/$/, '');
    if (rel !== '.' && rel !== '' && !rel.startsWith('..')) dirs.add(rel);
  };
  for (const base of baseDirs) {
    for (const name of PLAYWRIGHT_CONFIGS) {
      const file = join(root, base, name);
      if (existsSync(file)) for (const folder of literalValues(maskComments(readFileSync(file, 'utf8')), 'testDir')) add(base, folder);
    }
    for (const name of CYPRESS_CONFIGS) {
      const file = join(root, base, name);
      if (!existsSync(file)) continue;
      add(base, 'cypress');
      for (const glob of literalValues(maskComments(readFileSync(file, 'utf8')), 'specPattern')) add(base, staticFolder(glob));
    }
  }
  return [...dirs];
}

/**
 * Every file of the repo that Jest's defaults, jest-expo's presets or Expo's guide would treat as a
 * test, wherever it sits: `*.test|spec.[jt]s(x)`, any test file under `__tests__/`, and `*-test.[jt]s(x)`.
 * Left out: the repo-scan ignores and installed skills (walkRepo), reports, Stryker sandboxes, the
 * Maestro folder, `.d.ts` files, folders that are not workspaces but run their own tests (a
 * `functions/` package with its own Jest config or test script, a Detox `e2e/jest.config.js`, a
 * Playwright or Cypress project, Deno's `supabase/functions/deno.json`), the folders a root Playwright
 * `testDir` or Cypress `specPattern` names, and `ignore` (the contract's otherRunnerGlobs, --ignore).
 */
export function testCandidates(root, layout, { ignore = [] } = {}) {
  const workspaceDirs = new Set(layout.workspaces.map((workspace) => workspace.dir));
  const foreignDirs = foreignRunnerDirs(root, ['.', ...workspaceDirs]);
  const ownRunner = new Map();
  const isOwnRunner = (dir) => {
    if (!ownRunner.has(dir)) ownRunner.set(dir, !workspaceDirs.has(dir) && runsOwnTests(root, dir));
    return ownRunner.get(dir);
  };
  const underOwnRunner = (rel) => {
    if (foreignDirs.some((dir) => rel.startsWith(`${dir}/`))) return true;
    for (let dir = posix.dirname(rel); dir !== '.' && dir !== ''; dir = posix.dirname(dir)) if (isOwnRunner(dir)) return true;
    return false;
  };
  const walkIgnore = ['reports/**', '.stryker-tmp/**', '.skill-tooling/**', `${layout.e2eDir}/**`, '**/*.d.ts', ...ignore];
  return walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'], ignore: walkIgnore }).filter((rel) => {
    if (!SOURCE_FILE.test(rel) || rel.endsWith('.d.ts')) return false;
    const name = posix.basename(rel);
    const isNamed = NAMED_TEST.test(name);
    if (!isNamed && !IN_TESTS_DIR.test(rel) && !DASH_TEST.test(name)) return false;
    if (underOwnRunner(rel)) return false;
    return isNamed || TEST_CALL.test(maskComments(readFileSync(join(root, rel), 'utf8')));
  });
}

/** Defaults for the canonical layout (each workspace's folders when the repo has workspaces). */
export function contractDefaults(layout) {
  const layouts = layout.mode === 'monorepo' ? layout.workspaces.map((workspace) => workspace.layout) : [layout];
  const has = (dir) => existsSync(join(layout.root, dir));
  const logicCoverageKeys = [];
  const mutateGlobs = [];
  for (const one of layouts) {
    const single = layout.mode === 'single';
    if (single || has(one.coreDir)) {
      logicCoverageKeys.push(`./${one.coreDir}/`);
      mutateGlobs.push(`${one.coreDir}/**/*.ts`);
    }
    if (single || has(one.dataDir)) {
      logicCoverageKeys.push(`./${one.dataDir}/`);
      mutateGlobs.push(`${one.dataDir}/**/*.ts`);
    }
    if (single) logicCoverageKeys.push(`./${one.srcDir}/games/*/rules/**/*.ts`);
    mutateGlobs.push(`${one.srcDir}/**/*-policy.ts`, `${one.srcDir}/**/*-reducer.ts`);
    if (has(`${one.srcDir}/games`)) mutateGlobs.push(`${one.srcDir}/games/*/rules/**/*.ts`, `${one.srcDir}/games/*/levels/**/*.ts`);
  }
  return {
    renderHelper: { file: `${layout.testDir}/render-with-providers.tsx`, functions: [...RENDER_HELPER_FUNCTIONS] },
    routerHelper: { file: `${layout.testDir}/render-router-with-providers.tsx`, functions: [...ROUTER_HELPER_FUNCTIONS] },
    deviceOnlyHelper: `${layout.scriptsDir}/quality/device-only.ts`,
    rootMocks: [],
    logicCoverageKeys,
    mutateGlobs,
    styleContractGlobs: layouts.flatMap((one) => [`${one.uiDir}/**`, `${one.themeDir}/**`, `${one.i18nDir}/**`]),
    logicTestGlobs: layouts.flatMap((one) => [`${one.coreDir}/**`, `${one.dataDir}/**`, `${one.storesDir}/**`, `${one.servicesDir}/**`, `${one.apiDir}/**`, `${one.srcDir}/games/*/{rules,levels,sim}/**`]),
    otherRunnerGlobs: [],
  };
}

/**
 * The contract merged over the defaults. `given` (--contract) wins, then rn-skills.config.json
 * "testSetupContract", then <contractsDir>/test-setup.json. A missing file means the defaults; a
 * malformed one stops with exit 2 (bad input).
 */
export function loadContract(layout, given) {
  const configured = layout.config?.[CONTRACT_CONFIG_KEY];
  const rel = given ?? (typeof configured === 'string' ? configured : `${layout.contractsDir}/${CONTRACT_FILE}`);
  const defaults = contractDefaults(layout);
  const path = join(layout.root, rel);
  if (!existsSync(path)) {
    if (given !== undefined || typeof configured === 'string') fail(`the test-setup contract ${rel} does not exist`, 'Copy templates/contracts/test-setup.json there, or drop the option.');
    return { file: null, ...defaults };
  }
  let data;
  try {
    data = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(`${rel} is not valid JSON: ${String(error.message).split('\n')[0]}`, 'Fix the contract (templates/contracts/test-setup.json shows every key).');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${rel} must hold a JSON object`, 'Start from templates/contracts/test-setup.json.');
  for (const [key, value] of Object.entries(data)) {
    if (key === '$schema' || key === '$comment') continue;
    if (!(key in KEYS)) fail(`${rel} has an unknown key "${key}"`, `Use only: ${Object.keys(KEYS).join(', ')}.`);
    const ok = KEYS[key] === HELPER ? value && typeof value === 'object' && isRepoPath(value.file) && isStringList(value.functions) && value.functions.length > 0 : key === 'deviceOnlyHelper' ? isRepoPath(value) : isStringList(value);
    if (!ok) fail(`${rel} "${key}" must be ${KEYS[key]}`, 'templates/contracts/test-setup.schema.json describes every key.');
  }
  return { file: rel, ...defaults, ...Object.fromEntries(Object.entries(data).filter(([key]) => key in KEYS)) };
}
