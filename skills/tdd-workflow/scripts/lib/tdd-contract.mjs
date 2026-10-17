// lib/tdd-contract.mjs: what check-tests.mjs and check-test-edits.mjs share. The optional repo contract
// contracts/tdd.json holds the app's own facts (which folders hold logic that needs a test, which files
// count as production code in a commit, the app's requirement-ID pattern); without it the defaults come
// from the canonical layout (resolveLayout: src/ with @/ and @test/ aliases, or each workspace's src/
// when package.json has workspaces).

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { fail, parseJsonc } from '../check-lib.mjs';

export const CONTRACT_FILE = 'tdd.json';
/** rn-skills.config.json key that points at the contract when it is not contracts/tdd.json. */
export const CONTRACT_CONFIG_KEY = 'tddContract';

/** Test files every Jest project of the canonical set runs (unit, android, golden, sims, perf). */
export const TEST_FILE = /\.(?:test|golden\.test|sim\.test|perf\.test)\.tsx?$/;
/** The skill's scripts/ folder; assets/ sits beside it. */
const SCRIPTS_DIR = new URL('../', import.meta.url);
/**
 * A requirement reference when the contract sets no requirementIdPattern: a ticket key (TASKS-12), an
 * issue number (#41) or a named reference (issue 41, spec 4.2, story 7). Read from
 * assets/requirement-ref.json, a synced copy of the data file git-commits-and-reporting's commit-msg
 * rules read (scripts/git/requirement-ref.json), so a Spec-Change trailer the hook accepts passes here.
 */
export const DEFAULT_REQUIREMENT_REF = (() => {
  const { pattern, flags } = JSON.parse(readFileSync(new URL('../assets/requirement-ref.json', SCRIPTS_DIR), 'utf8'));
  return new RegExp(pattern, flags);
})();
/** Helpers that are not production code even inside a source folder. */
export const NOT_SOURCE = /(^|\/)(fixtures|testing|__mocks__)\/|\.d\.ts$/;

const KEYS = Object.freeze({
  logicGlobs: 'a list of globs (repo-relative)',
  sourceGlobs: 'a list of globs (repo-relative)',
  ignore: 'a list of globs (repo-relative)',
  requirementIdPattern: 'a regular expression source string, or null',
});

const isGlobList = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim() !== '' && !entry.startsWith('/') && !entry.split('/').includes('..'));

/** Every app layout of the repo: the root, and each workspace when package.json has workspaces. */
export function appLayouts(layout) {
  return [layout, ...layout.workspaces.map((workspace) => workspace.layout)];
}

/** The source folders of every app (tests there are app-world: Jest types only, no Node APIs). */
export function appSourceDirs(layout) {
  return [...new Set(appLayouts(layout).map((app) => app.srcDir))];
}

/** The Expo Router routes folder of every app (Expo bundles every file there as a route). */
export function routeDirs(layout) {
  return [...new Set(appLayouts(layout).map((app) => app.routesDir))];
}

/**
 * Default logic globs: the folders where pure logic, data, services, stores, the API layer, feature
 * models and shared hooks live. Each .ts module there with a runtime export needs a test.
 */
export function defaultLogicGlobs(layout) {
  const globs = appLayouts(layout).flatMap((app) => [app.coreDir, app.dataDir, app.servicesDir, app.storesDir, app.apiDir, app.featuresDir, posix.join(app.srcDir, 'hooks')].map((dir) => `${dir}/**`));
  return [...new Set(globs)];
}

/** Default production code for the history rules: every app's source folder, the repo's scripts/ and local config plugins. */
export function defaultSourceGlobs(layout) {
  const globs = [...appSourceDirs(layout).map((dir) => `${dir}/**`), `${layout.scriptsDir}/**`, 'plugins/**'];
  return [...new Set(globs)];
}

function contractPath(root, layout, given) {
  if (given) return { rel: given, abs: join(root, given), required: true };
  const configured = layout.config?.[CONTRACT_CONFIG_KEY];
  if (configured !== undefined) {
    if (typeof configured !== 'string' || configured.trim() === '') fail(`rn-skills.config.json "${CONTRACT_CONFIG_KEY}" must be a repo-relative file path`, `Set "${CONTRACT_CONFIG_KEY}": "contracts/${CONTRACT_FILE}" or remove the key.`);
    return { rel: configured, abs: join(root, configured), required: true };
  }
  const rel = posix.join(layout.contractsDir, CONTRACT_FILE);
  return { rel, abs: join(root, rel), required: false };
}

/**
 * The contract merged over the defaults. A missing default contract means the defaults; a contract
 * named by --contract or rn-skills.config.json must exist; a malformed one is bad input (exit 2).
 */
export function readTddContract(root, layout, given) {
  const path = contractPath(root, layout, given);
  const defaults = { file: null, logicGlobs: defaultLogicGlobs(layout), sourceGlobs: defaultSourceGlobs(layout), ignore: [], requirementPattern: null };
  if (!existsSync(path.abs)) {
    if (path.required) fail(`the TDD contract ${path.rel} does not exist`, `Copy templates/contracts/${CONTRACT_FILE} there, or drop the option.`);
    return defaults;
  }
  let data;
  try {
    data = parseJsonc(readFileSync(path.abs, 'utf8'));
  } catch (error) {
    return fail(`${path.rel} is not valid JSON: ${String(error.message).split('\n')[0]}`, `Fix ${path.rel} (templates/contracts/${CONTRACT_FILE} shows the shape).`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${path.rel} must hold one JSON object`, `Start from templates/contracts/${CONTRACT_FILE}.`);
  for (const [key, value] of Object.entries(data)) {
    if (key === '$schema' || key === '$comment') continue;
    if (!(key in KEYS)) fail(`${path.rel}: unknown key "${key}"`, `Known keys: ${Object.keys(KEYS).join(', ')}.`);
    if (key === 'requirementIdPattern') {
      if (value !== null && (typeof value !== 'string' || value.trim() === '')) fail(`${path.rel}: requirementIdPattern must be ${KEYS[key]}`, 'Write a pattern such as "\\\\bTASKS-\\\\d+\\\\b", or null for an app without requirement IDs.');
    } else if (!isGlobList(value)) fail(`${path.rel}: ${key} must be ${KEYS[key]}`, 'List repo-relative globs without ".." or a leading "/".');
  }
  let requirementPattern = null;
  if (typeof data.requirementIdPattern === 'string') {
    try {
      requirementPattern = new RegExp(data.requirementIdPattern, 'u');
    } catch (error) {
      fail(`${path.rel}: requirementIdPattern is not a valid regular expression (${error.message})`, 'Fix the pattern; test it with node -e "new RegExp(...)".');
    }
  }
  return {
    file: path.rel,
    logicGlobs: data.logicGlobs ?? defaults.logicGlobs,
    sourceGlobs: data.sourceGlobs ?? defaults.sourceGlobs,
    ignore: data.ignore ?? [],
    requirementPattern,
  };
}
