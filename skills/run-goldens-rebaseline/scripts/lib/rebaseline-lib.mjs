// rebaseline-lib.mjs: the shared logic of rebaseline.mjs (the runner) and check-rebaseline.mjs (the
// checker) of run-goldens-rebaseline. Zero dependencies (node: built-ins and ../check-lib.mjs).
//
// A rebaseline keeps its evidence in one folder (default reports/rebaseline/, git-ignored):
//   before.json        the inventory --start recorded: golden hashes, frozen-file hashes, contract entries
//   assertions.json    Jest --json of every non-golden project (green before any update)
//   triage.json        Jest --json of the whole golden project without -u (the affected set)
//   update-NN.json     Jest --json of each -u run (exactly one golden test file each)
//   proof-NN.json      Jest --json of the whole golden project without -u, after the last update (two runs)
//   inspection.json    one entry per changed golden path: { path, verdict, note }
//   triage-diffs/      the diff images the triage run wrote (an update deletes the originals)

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, relative } from 'node:path';

import { UsageError, matchGlob, parseJsonc, resolveLayout, sha256, toPosix, walkRepo } from '../check-lib.mjs';

export const EVIDENCE_VERSION = 1;
export const DEFAULT_EVIDENCE_DIR = 'reports/rebaseline';
export const DEFAULT_MARKER = '[contract]';
export const DEFAULT_GOLDEN_PROJECT = 'golden';
export const MIN_REASON = 10;
export const MIN_NOTE = 15;
export const MIN_TRAILER = 10;
/** The variable that turns on jest-image-snapshot's outdated-snapshot-reporter (it deletes untouched -snap.png files). */
export const TRACK_OBSOLETE_VAR = 'JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE';
/** Written by --proof next to proof-NN.json: the golden hashes the proof ran against. */
export const PROOF_GOLDENS = 'proof-goldens.json';
export const VERDICTS = Object.freeze({ intended: 'a changed or added golden whose new content is what users should get', orphan: 'a deleted golden whose test no longer claims it' });

/** Files a rebaseline may write without changing what the app is: reports, caches, diff images. */
export const VOLATILE_IGNORES = Object.freeze([
  'reports/**',
  '**/__diff_output__/**',
  '.stryker-tmp/**',
  '**/*.tsbuildinfo',
  'expo-env.d.ts',
  '.eslintcache',
  '.metro-health-check*',
]);

const SNAPSHOT_GOLDEN = /\.golden\.test\.ts\.snap(?:\.(?:ios|android))?$/;
const IMAGE_GOLDEN = /(?:^|\/)__image_snapshots__\/(?:.*\/)?[^/]+\.png$/;
const GOLDEN_TEST = /\.golden\.test\.ts$/;
const NON_GOLDEN_TEST = /\.test\.tsx?$/;
const NOT_ASSERTION_TEST = /\.(?:golden|sim)\.test\.tsx?$/;

const fixFor = (file) => `Fix ${file}, or start over with rebaseline.mjs --start --restart.`;

/** Repo-relative posix path, or a UsageError naming what was wrong. */
export function repoRelative(value, what) {
  if (typeof value !== 'string' || value.trim() === '') throw new UsageError(`${what} must be a non-empty repo-relative path`, 'Pass a path relative to the repo root.');
  const clean = toPosix(value.trim()).replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) throw new UsageError(`${what} "${value}" leaves the repo`, 'Pass a path inside the repo.');
  return clean;
}

export function readJson(root, rel, what) {
  const abs = join(root, rel);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    throw new UsageError(`${what} ${rel} cannot be read`, fixFor(rel));
  }
  try {
    return parseJsonc(text);
  } catch (error) {
    throw new UsageError(`${what} ${rel} is not valid JSON: ${String(error.message).split('\n')[0]}`, fixFor(rel));
  }
}

function listOfStrings(value, what) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) throw new UsageError(`${what} must be a list of non-empty strings`, 'Fix rn-skills.config.json.');
  return value.map((item) => item.trim());
}

/** True when package.json lists jest (the whole ritual is about Jest goldens). */
export function hasJest(manifest) {
  return ['dependencies', 'devDependencies'].some((field) => manifest?.[field] && typeof manifest[field] === 'object' && 'jest' in manifest[field]);
}

/**
 * Where the repo keeps everything the ritual touches. Precedence per value: the script option >
 * rn-skills.config.json > the canonical layout. Keys documented in references/evidence-and-checker.md.
 */
export function loadSetup(root, options = {}) {
  const layout = resolveLayout(root);
  const config = layout.config ?? {};
  const evidenceDir = repoRelative(options.evidenceDir ?? config.rebaselineEvidenceDir ?? DEFAULT_EVIDENCE_DIR, 'the evidence folder');
  const goldensDir = repoRelative(config.goldensDir ?? posix.join(layout.testDir, 'goldens'), 'the goldens folder (goldensDir)');
  const matcher = repoRelative(config.pixelMatcher ?? posix.join(goldensDir, 'skia-golden.ts'), 'the pixel matcher (pixelMatcher)');
  const contractFile = repoRelative(config.goldensContract ?? posix.join(layout.contractsDir, 'goldens.json'), 'the goldens contract (goldensContract)');
  const goldenProject = options.goldenProject ?? config.goldenProject ?? DEFAULT_GOLDEN_PROJECT;
  if (typeof goldenProject !== 'string' || !/^[\w.-]+$/.test(goldenProject)) throw new UsageError(`the golden project name "${goldenProject}" is not a Jest project name`, 'Pass the displayName of the golden Jest project (default "golden").');
  const workspaceRoots = layout.workspaces.flatMap((workspace) => [workspace.layout.srcDir, workspace.layout.testDir]);
  const testRoots = listOfStrings(config.rebaselineTestRoots, 'rebaselineTestRoots');
  const contract = readContract(root, contractFile);
  return {
    root,
    layout,
    evidenceDir,
    matcher,
    contractFile,
    markers: contract.markers,
    frozenGoldenPaths: contract.goldenPaths,
    goldenProject,
    e2eBaselines: posix.join(layout.e2eDir, 'baselines'),
    testRoots: testRoots.length > 0 ? testRoots.map((dir) => repoRelative(dir, 'rebaselineTestRoots entry')) : [...new Set([layout.srcDir, layout.testDir, layout.scriptsDir, 'plugins', ...workspaceRoots])],
    ignores: [...VOLATILE_IGNORES, `${evidenceDir}/**`, ...listOfStrings(config.rebaselineIgnore, 'rebaselineIgnore')],
  };
}

/** contracts/goldens.json (golden-and-snapshot-tests' register): only the markers and extra frozen paths matter here. */
function readContract(root, file) {
  if (!existsSync(join(root, file))) return { markers: [DEFAULT_MARKER], goldenPaths: [] };
  const data = readJson(root, file, 'the goldens contract');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new UsageError(`${file} must hold one JSON object`, `Fix ${file}.`);
  const markers = listOfStrings(data.contractMarkers, `${file} contractMarkers`);
  return { markers: markers.length > 0 ? markers : [DEFAULT_MARKER], goldenPaths: listOfStrings(data.goldenPaths, `${file} goldenPaths`) };
}

/** 'snapshot' | 'image' | 'screenshot' | null: the golden paths a rebaseline may rewrite. */
export function goldenKind(rel, setup) {
  if (rel.startsWith(`${setup.e2eBaselines}/`) && rel.endsWith('.png')) return 'screenshot';
  if (rel.includes('__diff_output__/')) return null;
  if (SNAPSHOT_GOLDEN.test(rel)) return 'snapshot';
  if (IMAGE_GOLDEN.test(rel)) return 'image';
  return null;
}

export const isGoldenTest = (rel) => GOLDEN_TEST.test(rel);

function hashFile(root, rel) {
  return sha256(readFileSync(join(root, rel)));
}

/**
 * Walk the repo once: every golden path with its hash, every other file (the frozen set) with its
 * hash, the golden test files and the non-golden test files under the Jest test roots.
 */
export function takeInventory(root, setup) {
  const files = walkRepo(root, { ignore: setup.ignores });
  const goldens = {};
  const frozen = {};
  const goldenTests = [];
  const assertionTests = [];
  for (const rel of files) {
    if (goldenKind(rel, setup) !== null) goldens[rel] = hashFile(root, rel);
    else frozen[rel] = hashFile(root, rel);
    if (isGoldenTest(rel)) goldenTests.push(rel);
    else if (NON_GOLDEN_TEST.test(rel) && !NOT_ASSERTION_TEST.test(rel) && setup.testRoots.some((dir) => rel.startsWith(`${dir}/`))) assertionTests.push(rel);
  }
  return { goldens, frozen, goldenTests, assertionTests };
}

/** The entries of a Jest snapshot file: [{ key, body, index }]. */
export function snapshotEntries(text) {
  const entries = [];
  for (const match of text.matchAll(/^exports\[`([\s\S]*?)`\] = `\n?([\s\S]*?)\n?`;$/gm)) entries.push({ key: match[1], body: match[2], index: match.index });
  return entries;
}


export const isContractKey = (key, markers) => markers.some((marker) => key.includes(marker));

/** Every snapshot entry whose key carries a contract marker, with the hash of its body. */
export function contractEntries(root, setup, goldens) {
  const list = [];
  for (const rel of Object.keys(goldens).filter((path) => goldenKind(path, setup) === 'snapshot').sort()) {
    for (const entry of snapshotEntries(readFileSync(join(root, rel), 'utf8'))) {
      if (isContractKey(entry.key, setup.markers)) list.push({ file: rel, key: entry.key, sha256: sha256(entry.body) });
    }
  }
  return list;
}

/**
 * A digest of a snapshot file's entries (keys and bodies), blind to the header line: equal digests
 * mean only the header changed (a Jest major rewrites "// Jest Snapshot v1, <link>").
 */
export function entriesDigest(text) {
  return sha256(JSON.stringify(snapshotEntries(text).map((entry) => [entry.key, entry.body])));
}

/** { path: entriesDigest } for every golden snapshot file. */
export function snapshotDigests(root, setup, goldens) {
  const digests = {};
  for (const rel of Object.keys(goldens).filter((path) => goldenKind(path, setup) === 'snapshot').sort()) digests[rel] = entriesDigest(readFileSync(join(root, rel), 'utf8'));
  return digests;
}

/** The test file a snapshot belongs to (jest-expo resolvers: next to the test, or __tests__/__snapshots__/). */
export function testOfSnapshot(rel) {
  const inFolder = /(^|\/)__snapshots__\/([^/]+)\.snap(?:\.(?:ios|android))?$/.exec(rel);
  if (inFolder) return posix.join(posix.dirname(posix.dirname(rel)), inFolder[2]);
  const beside = /^(.*\.(?:ts|tsx|js|jsx))\.snap(?:\.(?:ios|android))?$/.exec(rel);
  return beside ? beside[1] : null;
}

/** lodash-style kebab case, as jest-image-snapshot builds its default identifier. */
export function kebabCase(text) {
  return (text.match(/[A-Z]{2,}(?=[A-Z][a-z]|[^A-Za-z]|$)|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g) ?? []).map((word) => word.toLowerCase()).join('-');
}

/**
 * Which baseline names a pixel golden test claims: { all: true } when its identifier is computed
 * (a variable or a function) or starts with a placeholder, else the static prefixes.
 */
export function imageClaims(root, testRel) {
  const code = readFileSync(join(root, testRel), 'utf8');
  const literal = [...code.matchAll(/\bcustomSnapshotIdentifier\s*:\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((match) => match[2].split('${')[0]);
  const computed = /\bcustomSnapshotIdentifier\s*(?::\s*(?=[^\s'"`])|[,}])/.test(code);
  if (computed || literal.some((prefix) => prefix === '')) return { all: true, prefixes: [] };
  if (literal.length > 0) return { all: false, prefixes: literal };
  // jest-image-snapshot's default: kebabCase(`${basename(testPath)}-${testName}-${counter}`) + '-snap'.
  return { all: false, prefixes: [`${kebabCase(posix.basename(testRel))}-`] };
}

/** The golden tests that claim a baseline PNG (tests in the folder that holds __image_snapshots__/). */
export function claimingTests(root, pngRel, goldenTests) {
  const parts = pngRel.split('/');
  const at = parts.lastIndexOf('__image_snapshots__');
  const folder = parts.slice(0, at).join('/');
  const name = parts[parts.length - 1];
  return goldenTests.filter((test) => posix.dirname(test) === (folder || '.') && existsSync(join(root, test))).filter((test) => {
    const claims = imageClaims(root, test);
    return claims.all || claims.prefixes.some((prefix) => name.startsWith(prefix));
  });
}

/** The contract-marker keys of a snapshot file (an orphan holding any cannot be deleted inside a rebaseline). */
export function contractKeysIn(root, rel, markers) {
  return snapshotEntries(readFileSync(join(root, rel), 'utf8')).map((entry) => entry.key).filter((key) => isContractKey(key, markers));
}

/** Golden snapshots whose test file is gone and baseline PNGs no golden test claims: [{ path, kind, test }]. */
export function orphanGoldens(root, setup, inventory) {
  const orphans = [];
  for (const path of Object.keys(inventory.goldens)) {
    const kind = goldenKind(path, setup);
    if (kind === 'snapshot') {
      const test = testOfSnapshot(path);
      if (test !== null && !existsSync(join(root, test))) orphans.push({ path, kind, test });
    } else if (kind === 'image' && claimingTests(root, path, inventory.goldenTests).length === 0) orphans.push({ path, kind, test: null });
  }
  return orphans;
}

/** [{ path, change: 'added' | 'modified' | 'deleted' }] between two { path: hash } maps. */
export function diffMaps(before, now) {
  const changes = [];
  for (const [path, hash] of Object.entries(before)) {
    if (!(path in now)) changes.push({ path, change: 'deleted' });
    else if (now[path] !== hash) changes.push({ path, change: 'modified' });
  }
  for (const path of Object.keys(now)) if (!(path in before)) changes.push({ path, change: 'added' });
  return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// The evidence
// ---------------------------------------------------------------------------------------------

export const evidencePath = (setup, name) => posix.join(setup.evidenceDir, name);

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((hash) => typeof hash === 'string');
}

/** before.json, validated; null when no rebaseline was started. */
export function readBefore(root, setup) {
  const rel = evidencePath(setup, 'before.json');
  if (!existsSync(join(root, rel))) return null;
  const data = readJson(root, rel, 'the rebaseline start record');
  const bad = (what) => {
    throw new UsageError(`${rel} ${what}`, `Do not edit it by hand; start over with rebaseline.mjs --start --restart --reason "<cause>".`);
  };
  if (data === null || typeof data !== 'object' || Array.isArray(data)) bad('must hold one JSON object');
  if (data.version !== EVIDENCE_VERSION) bad(`has version ${JSON.stringify(data.version)}, expected ${EVIDENCE_VERSION}`);
  if (!Number.isFinite(data.startedAt)) bad('has no numeric "startedAt"');
  if (typeof data.reason !== 'string') bad('has no "reason"');
  if (!isMap(data.goldens) || !isMap(data.frozen)) bad('needs "goldens" and "frozen" maps of path to sha256');
  if (!Array.isArray(data.goldenTests) || !Array.isArray(data.contractEntries)) bad('needs "goldenTests" and "contractEntries" lists');
  return { ...data, file: rel };
}

/** The repo-relative posix path of a Jest test result name (absolute in real runs, relative in captures). */
function resultPath(root, name) {
  if (typeof name !== 'string' || name === '') return null;
  const posixName = toPosix(name);
  if (!isAbsolute(name) && !/^[A-Za-z]:\//.test(posixName)) return posixName.replace(/^\.\//, '');
  const roots = [root];
  try {
    roots.push(realpathSync(root));
  } catch {
    // keep the given root only
  }
  for (const base of roots) {
    let candidate = toPosix(relative(base, name));
    if (!candidate.startsWith('..') && !isAbsolute(candidate)) return candidate;
    try {
      candidate = toPosix(relative(base, realpathSync(name)));
      if (!candidate.startsWith('..') && !isAbsolute(candidate)) return candidate;
    } catch {
      // the file is gone (a removed test): the plain relative path above was outside the root
    }
  }
  return posixName;
}

const number = (value) => (Number.isFinite(value) ? value : 0);

/** A Jest --json result, normalized: { file, startTime, endTime, success, files: [...], snapshot, unchecked }. */
export function readJestResult(root, rel) {
  const data = readJson(root, rel, 'the Jest result');
  if (data === null || typeof data !== 'object' || !Array.isArray(data.testResults) || typeof data.success !== 'boolean' || !Number.isFinite(data.startTime)) {
    throw new UsageError(`${rel} is not a Jest --json result (needs success, startTime and testResults)`, `Write it with jest ... --json --outputFile ${rel} (rebaseline.mjs does), never by hand.`);
  }
  const files = data.testResults.map((result) => ({
    path: resultPath(root, result.name),
    status: result.status,
    startTime: number(result.startTime),
    endTime: number(result.endTime),
    assertions: Array.isArray(result.assertionResults) ? result.assertionResults.map((assertion) => ({ ancestorTitles: Array.isArray(assertion.ancestorTitles) ? assertion.ancestorTitles : [], title: String(assertion.title ?? ''), status: assertion.status })) : [],
  }));
  const absolute = files.filter((file) => file.path !== null && (isAbsolute(file.path) || /^[A-Za-z]:\//.test(file.path)));
  if (files.length > 0 && absolute.length === files.length) {
    throw new UsageError(`every test path in ${rel} lies outside ${root} (first: ${absolute[0].path}): the evidence was written in another location (a moved repo, another worktree or a container path)`, 'Jest results hold absolute paths: start over in this location with rebaseline.mjs . --start --restart --reason "<cause>".');
  }
  const snapshot = data.snapshot ?? {};
  const unchecked = Array.isArray(snapshot.uncheckedKeysByFile) ? snapshot.uncheckedKeysByFile.map((entry) => ({ path: resultPath(root, entry.filePath), keys: Array.isArray(entry.keys) ? entry.keys : [] })) : [];
  const endTime = Math.max(data.startTime, ...files.map((file) => file.endTime));
  return {
    file: rel,
    startTime: data.startTime,
    endTime,
    success: data.success,
    numFailedTests: number(data.numFailedTests) + number(data.numRuntimeErrorTestSuites),
    numTotalTests: number(data.numTotalTests),
    files,
    snapshot: {
      added: number(snapshot.added),
      updated: number(snapshot.updated),
      unmatched: number(snapshot.unmatched),
      unchecked: number(snapshot.unchecked),
      didUpdate: snapshot.didUpdate === true,
    },
    unchecked: unchecked.filter((entry) => entry.keys.length > 0),
  };
}

function numbered(root, setup, prefix) {
  const dir = join(root, setup.evidenceDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => new RegExp(`^${prefix}-\\d+\\.json$`).test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((name) => evidencePath(setup, name));
}

export const updateFiles = (root, setup) => numbered(root, setup, 'update');
export const proofFiles = (root, setup) => numbered(root, setup, 'proof');

/** The next free update-NN.json / proof-NN.json name. */
export function nextNumbered(root, setup, prefix) {
  const taken = numbered(root, setup, prefix).map((rel) => Number(rel.match(/-(\d+)\.json$/)[1]));
  return evidencePath(setup, `${prefix}-${String((taken.length === 0 ? 0 : Math.max(...taken)) + 1).padStart(2, '0')}.json`);
}

/** proof-goldens.json, validated: { writtenAt, goldens }; null when missing. */
export function readProofGoldens(root, setup) {
  const rel = evidencePath(setup, PROOF_GOLDENS);
  if (!existsSync(join(root, rel))) return null;
  const data = readJson(root, rel, 'the proof golden record');
  if (data === null || typeof data !== 'object' || !Number.isFinite(data.writtenAt) || !isMap(data.goldens)) {
    throw new UsageError(`${rel} needs a numeric "writtenAt" and a "goldens" map of path to sha256`, 'Do not edit it by hand; rerun rebaseline.mjs . --proof, which writes it.');
  }
  return { file: rel, writtenAt: data.writtenAt, goldens: data.goldens };
}

export function readOptionalResult(root, setup, name) {
  const rel = evidencePath(setup, name);
  return existsSync(join(root, rel)) ? readJestResult(root, rel) : null;
}

/** Golden test files the triage run shows failing or holding obsolete entries: the only files a rebaseline updates. */
export function plannedFiles(triage) {
  const planned = new Set();
  for (const file of triage.files) if (file.status === 'failed' && file.path && isGoldenTest(file.path)) planned.add(file.path);
  for (const entry of triage.unchecked) if (entry.path && isGoldenTest(entry.path)) planned.add(entry.path);
  return planned;
}

/** Failing assertions inside a describe (or a title) that carries a contract marker: [{ path, title }]. */
export function failingContracts(result, markers) {
  const list = [];
  for (const file of result.files) {
    for (const assertion of file.assertions) {
      const titles = [...assertion.ancestorTitles, assertion.title];
      if (assertion.status === 'failed' && titles.some((title) => isContractKey(String(title), markers))) list.push({ path: file.path, title: titles.join(' ') });
    }
  }
  for (const entry of result.unchecked) for (const key of entry.keys) if (isContractKey(key, markers)) list.push({ path: entry.path, title: `${key} (obsolete: its test was renamed or removed)` });
  return list;
}

/** inspection.json: { entries: [{ path, verdict, note }] }, or null when missing. */
export function readInspection(root, setup) {
  const rel = evidencePath(setup, 'inspection.json');
  if (!existsSync(join(root, rel))) return null;
  const data = readJson(root, rel, 'the inspection record');
  const fix = 'Keep { "entries": [{ "path": "<golden path>", "verdict": "intended" | "orphan", "note": "<what changed and why it is right>" }] } (see examples/inspection.json).';
  if (data === null || typeof data !== 'object' || !Array.isArray(data.entries)) throw new UsageError(`${rel} must hold { "entries": [...] }`, fix);
  const entries = data.entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string') throw new UsageError(`${rel}: entries[${index}] needs a "path" string`, fix);
    return { path: entry.path, verdict: entry.verdict ?? null, note: typeof entry.note === 'string' ? entry.note : '', change: entry.change ?? null, index };
  });
  return { file: rel, data, entries };
}

// ---------------------------------------------------------------------------------------------
// The install
// ---------------------------------------------------------------------------------------------

/**
 * Packages whose installed version differs from package-lock.json: [{ name, lock, installed }].
 * Returns null when the repo has no package-lock.json (pnpm, yarn or bun keep their own lockfile).
 * Optional and platform-specific packages may be absent; linked workspaces are not compared.
 */
export function lockMismatches(root) {
  const lockPath = join(root, 'package-lock.json');
  if (!existsSync(lockPath)) return null;
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    throw new UsageError(`package-lock.json is not valid JSON: ${String(error.message).split('\n')[0]}`, 'Restore it from git, then run npm ci.');
  }
  const packages = lock?.packages;
  if (packages === null || typeof packages !== 'object') throw new UsageError('package-lock.json has no "packages" map (lockfileVersion 1 is not supported)', 'Regenerate it with npm 7 or newer (npm install), commit it, then run npm ci.');
  const mismatches = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith('node_modules/') || entry === null || typeof entry !== 'object' || entry.link === true || typeof entry.version !== 'string') continue;
    const manifestPath = join(root, key, 'package.json');
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    let installed = null;
    try {
      installed = JSON.parse(readFileSync(manifestPath, 'utf8')).version ?? null;
    } catch {
      installed = null;
    }
    if (installed === null) {
      if (entry.optional === true || entry.devOptional === true || entry.peer === true || entry.os || entry.cpu) continue;
      mismatches.push({ name: key, lock: entry.version, installed: 'missing' });
    } else if (installed !== entry.version) mismatches.push({ name, lock: entry.version, installed });
  }
  return mismatches;
}

/** Problems for lockMismatches(), at most `limit` lines plus one summary line. */
export function reportLockMismatches(report, mismatches, limit = 10) {
  const fix = 'Run npm ci (the install must be exactly the lockfile, or the goldens you write differ from CI), then start over with --start --restart.';
  for (const entry of mismatches.slice(0, limit)) {
    report.problem({ file: 'package-lock.json', line: 1, rule: 'install-matches-lock', message: `${entry.name} is ${entry.installed === 'missing' ? 'not installed' : `installed at ${entry.installed}`}, the lockfile says ${entry.lock}`, fix });
  }
  if (mismatches.length > limit) report.problem({ file: 'package-lock.json', line: 1, rule: 'install-matches-lock', message: `and ${mismatches.length - limit} more packages differ from the lockfile`, fix });
}

/** Captured or live `git status --porcelain=v1` output → [{ status, path }]. */
export function parsePorcelain(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.length < 4) continue;
    const status = line.slice(0, 2);
    let path = line.slice(3);
    if (path.includes(' -> ')) path = path.split(' -> ')[1];
    entries.push({ status, path: toPosix(path.replace(/^"|"$/g, '')) });
  }
  return entries;
}

/** Is `rel` one of the frozen golden paths contracts/goldens.json lists (vectors, data fixtures)? */
export function isFrozenGoldenPath(rel, setup) {
  return setup.frozenGoldenPaths.some((glob) => matchGlob(rel, glob));
}

export function isFile(root, rel) {
  return existsSync(join(root, rel)) && statSync(join(root, rel)).isFile();
}
