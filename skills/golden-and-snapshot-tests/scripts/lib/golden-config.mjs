// golden-config.mjs: where the app keeps its goldens and the repo-owned contract file both checkers
// of golden-and-snapshot-tests read (contracts/goldens.json). Zero dependencies.
//
// Precedence for each path: the script option > rn-skills.config.json (goldensDir, pixelMatcher,
// goldensContract) > the canonical layout (<testDir>/goldens, <goldensDir>/skia-golden.ts,
// <contractsDir>/goldens.json). The contract file is optional: without it no contract is declared.

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, parseJsonc, resolveLayout, toPosix } from '../check-lib.mjs';

export const DEFAULT_MARKER = '[contract]';
export const CONTRACT_KEYS = ['$schema', '$comment', 'contracts', 'goldenPaths', 'contractMarkers', 'maxPixelTolerance'];
/** The pixel matcher's limit (failureThreshold, percent type): 0.1% of pixels unless the reviewer approved more. */
export const DEFAULT_PIXEL_TOLERANCE = 0.001;
export const CONTRACT_ENTRY_KEYS = ['id', 'test', 'why'];

/** Data golden snapshots (what jest-expo's platform resolvers write) and pixel baselines. */
export const SNAPSHOT_GOLDEN_GLOBS = ['**/*.golden.test.ts.snap', '**/*.golden.test.ts.snap.ios', '**/*.golden.test.ts.snap.android'];
export const IMAGE_GOLDEN_GLOB = '**/__image_snapshots__/**';

function repoRelative(value, what, fix) {
  if (typeof value !== 'string' || value.trim() === '') throw new UsageError(`${what} must be a non-empty repo-relative path`, fix);
  const clean = toPosix(value.trim()).replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) throw new UsageError(`${what} "${value}" leaves the repo`, fix);
  return clean;
}

function readContract(root, file) {
  const abs = join(root, file);
  const empty = { file, exists: false, text: '', contracts: [], goldenPaths: [], contractMarkers: [DEFAULT_MARKER], maxPixelTolerance: DEFAULT_PIXEL_TOLERANCE };
  if (!existsSync(abs)) return empty;
  const text = readFileSync(abs, 'utf8');
  const fix = `Fix ${file} (keys: ${CONTRACT_KEYS.join(', ')}; see the skill's templates/contracts/goldens.schema.json).`;
  let data;
  try {
    data = parseJsonc(text);
  } catch (error) {
    throw new UsageError(`${file} is not valid JSON: ${String(error.message).split('\n')[0]}`, fix);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new UsageError(`${file} must hold one JSON object`, fix);
  const unknown = Object.keys(data).filter((key) => !CONTRACT_KEYS.includes(key));
  if (unknown.length > 0) throw new UsageError(`${file} has unknown key(s): ${unknown.join(', ')}`, fix);
  const list = (key) => {
    const value = data[key] ?? [];
    if (!Array.isArray(value)) throw new UsageError(`${file}: "${key}" must be a list`, fix);
    return value;
  };
  const contracts = list('contracts').map((entry, index) => {
    const where = `${file}: contracts[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new UsageError(`${where} must be an object`, fix);
    const extra = Object.keys(entry).filter((key) => !CONTRACT_ENTRY_KEYS.includes(key));
    if (extra.length > 0) throw new UsageError(`${where} has unknown key(s): ${extra.join(', ')}`, fix);
    if (typeof entry.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) throw new UsageError(`${where}: "id" must be kebab-case`, fix);
    const test = repoRelative(entry.test, `${where}.test`, fix);
    if (!test.endsWith('.golden.test.ts')) throw new UsageError(`${where}.test "${entry.test}" is not a *.golden.test.ts file`, fix);
    return { id: entry.id, test, why: typeof entry.why === 'string' ? entry.why : '' };
  });
  const strings = (key, min) => list(key).map((value, index) => {
    if (typeof value !== 'string' || value.trim().length < min) throw new UsageError(`${file}: ${key}[${index}] must be a string of at least ${min} characters`, fix);
    return value.trim();
  });
  const goldenPaths = strings('goldenPaths', 1).map((glob) => repoRelative(glob, `${file}: goldenPaths entry`, fix));
  const markers = strings('contractMarkers', 3);
  const tolerance = data.maxPixelTolerance ?? DEFAULT_PIXEL_TOLERANCE;
  if (typeof tolerance !== 'number' || !(tolerance > 0) || tolerance > 0.05) throw new UsageError(`${file}: "maxPixelTolerance" must be a number above 0 and at most 0.05 (a failureThreshold of the percent type)`, fix);
  return { file, exists: true, text, contracts, goldenPaths, contractMarkers: markers.length > 0 ? markers : [DEFAULT_MARKER], maxPixelTolerance: tolerance };
}

/**
 * The golden set-up of the repo at `root`.
 *   options: { goldensDir, matcher, contract } from the script's command line (undefined = not given)
 * Returns { root, layout, goldensDir, goldensDirs, matcher, matcherName, contract }.
 */
export function loadGoldenSetup(root, options = {}) {
  const layout = resolveLayout(root);
  const config = layout.config ?? {};
  const fix = 'Pass a repo-relative path (option or rn-skills.config.json key).';
  const goldensDir = repoRelative(options.goldensDir ?? config.goldensDir ?? posix.join(layout.testDir, 'goldens'), 'the goldens folder', fix);
  const matcher = repoRelative(options.matcher ?? config.pixelMatcher ?? posix.join(goldensDir, 'skia-golden.ts'), 'the pixel matcher', fix);
  const contractFile = repoRelative(options.contract ?? config.goldensContract ?? posix.join(layout.contractsDir, 'goldens.json'), 'the goldens contract', fix);
  // When multi-package: each workspace may keep its own test/goldens/ (and matcher) next to the root one.
  const workspaceDirs = layout.workspaces.map((workspace) => posix.join(workspace.layout.testDir, 'goldens'));
  const matcherName = posix.basename(matcher).replace(/\.tsx?$/, '');
  return {
    root,
    layout,
    goldensDir,
    goldensDirs: [...new Set([goldensDir, ...workspaceDirs])],
    matcher,
    matcherName,
    contract: readContract(root, contractFile),
  };
}

/** The globs whose change needs a Gate-Change trailer (check-golden-changes). */
export function goldenPathGlobs(setup) {
  return [
    ...SNAPSHOT_GOLDEN_GLOBS,
    IMAGE_GOLDEN_GLOB,
    setup.matcher,
    `**/goldens/${posix.basename(setup.matcher)}`,
    `${setup.layout.e2eDir}/baselines/**`,
    setup.contract.file,
    ...setup.contract.goldenPaths,
  ];
}

/**
 * The entries quality-gates.json gatedPaths must hold (check-goldens rule gated-path-missing): the same
 * paths goldenPathGlobs() asks a trailer for, so the commit-msg hook and check-golden-changes agree.
 * The register itself is required once it exists (an app without contracts may have none).
 */
export function requiredGatedPaths(setup) {
  return [
    '**/*.golden.test.ts.snap.ios',
    '**/*.golden.test.ts.snap.android',
    '**/__snapshots__/*.golden.test.ts.snap',
    IMAGE_GOLDEN_GLOB,
    setup.matcher,
    `${setup.layout.e2eDir}/baselines/**`,
    ...(setup.contract.exists ? [setup.contract.file] : []),
    ...setup.contract.goldenPaths,
  ];
}

/** True when a snapshot key or describe title carries one of the contract markers. */
export function isContractKey(key, markers) {
  return markers.some((marker) => key.includes(marker));
}

/** The 1-based line of the first occurrence of `needle` in `text` (1 when absent). */
export function lineOfText(text, needle) {
  const index = text.indexOf(needle);
  if (index < 0) return 1;
  return text.slice(0, index).split('\n').length;
}
