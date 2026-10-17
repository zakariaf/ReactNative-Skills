// input-scope.mjs: where check-canvas-input looks (a helper, not an entry point).
// The canvas kit folder, the input kit folder, the surface folders and the declared packages come
// from check-lib's resolveLayout (the canonical single-app layout, tsconfig paths, package.json
// workspaces, rn-skills.config.json), per-script options, and the repo-owned contract
// contracts/canvas-input.json.
//
// rn-skills.config.json keys this skill reads (all optional):
//   "canvasKitDir":       "src/canvas"                     the canvas kit folder (skia-canvas-rendering's key)
//   "canvasGesturesDir":  "src/canvas/gestures"            the input kit folder (default <canvasKitDir>/gestures)
//   "canvasSurfaceDirs":  ["src/features/*/canvas", ...]   globs of surface folders (skia-canvas-rendering's key)
// A configured surface glob that matches no folder, or a contract surface whose folder does not exist,
// is bad input (exit 2): a silent "0 surfaces" would hide every surface it was meant to find.
//
// contracts/canvas-input.json keys: surfaces [{ id, dir, input, intentFile, intentExport, tappable }],
// buttonComponents, gestureExempt.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { globToRegExp, matchGlob, parseJsonc, resolveLayout, UsageError, walkRepo } from '../check-lib.mjs';
import { isTestFile } from './source-scan.mjs';

export const RNGH_PACKAGE = 'react-native-gesture-handler';
export const CONTRACT_NAME = 'canvas-input.json';
export const GESTURE_MODULE = 'use-canvas-gestures.ts';
/** The input kit: every file the checker requires in the gestures folder. */
export const KIT_FILES = Object.freeze([
  'canvas-intent.ts',
  'classify-swipe.ts',
  'stick-command.ts',
  'pan-intent.ts',
  'touch-targets.ts',
  GESTURE_MODULE,
  'use-canvas-gestures.test.tsx',
  'canvas-gesture-probe.tsx',
]);
/** Modules the gesture callbacks call on the UI thread: a plain JS function there throws at runtime. */
export const UI_THREAD_FILES = Object.freeze(['classify-swipe.ts', 'stick-command.ts', 'pan-intent.ts']);
/** Gesture code that must never branch on direction. */
export const DIRECTION_FREE_FILES = Object.freeze([GESTURE_MODULE, 'pan-intent.ts', 'classify-swipe.ts', 'stick-command.ts']);
/** Files whose shared values and JS hops follow the Worklets API rules. */
export const WORKLETS_API_FILES = Object.freeze([...KIT_FILES.filter((name) => !name.endsWith('.test.tsx')), 'stick-gesture-probe.tsx']);

const CONTRACT_KEYS = new Set(['$schema', '$comment', 'surfaces', 'buttonComponents', 'gestureExempt']);
const SURFACE_KEYS = new Set(['id', 'dir', 'input', 'intentFile', 'intentExport', 'tappable']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const GAMES_SURFACE = /(^|\/)games\/[^/]+\/canvas$/;

const isRepoRelative = (value) =>
  typeof value === 'string' && value.trim() !== '' && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes('..');
const clean = (dir) => posix.normalize(dir.replace(/\\/g, '/')).replace(/\/$/, '');
export const isInside = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

const contractFix = (rel) =>
  `Write ${rel} as { "surfaces": [{ "id": "progress-grid", "dir": "src/features/tasks/canvas" }], "buttonComponents": ["PressableSurface"], "gestureExempt": [] } (see canvas-input.schema.json in this skill's templates/contracts).`;
const contractError = (rel, message) => new UsageError(`${rel}: ${message}`, contractFix(rel));

function readJson(root, rel, what) {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON (${what}): ${error.message}`, `Fix the JSON in ${rel}.`);
  }
}

/** Every package name the repo declares (root and workspace manifests). */
function declaredPackages(root, layout) {
  const names = new Map();
  for (const rel of ['package.json', ...layout.workspaces.map((ws) => `${ws.dir}/package.json`)]) {
    if (!existsSync(join(root, rel))) continue;
    const pkg = readJson(root, rel, 'a package manifest');
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [name, spec] of Object.entries(pkg?.[key] ?? {})) if (!names.has(name)) names.set(name, { spec: String(spec), manifest: rel });
    }
  }
  return names;
}

function stringList(rel, value, key, pattern) {
  if (value === undefined) return [];
  const isValid = Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry !== '' && (pattern === undefined || pattern.test(entry))) && new Set(value).size === value.length;
  if (!isValid) throw contractError(rel, `"${key}" must be a list of unique ${pattern === undefined ? 'non-empty strings' : `names matching ${pattern}`}`);
  return value;
}

function validateSurface(rel, entry, index) {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw contractError(rel, `surfaces[${index}] must be an object`);
  const extra = Object.keys(entry).filter((key) => !SURFACE_KEYS.has(key));
  if (extra.length > 0) throw contractError(rel, `surfaces[${index}] has unknown keys: ${extra.join(', ')}`);
  if (typeof entry.id !== 'string' || !KEBAB.test(entry.id)) throw contractError(rel, `surfaces[${index}].id must be a kebab-case id`);
  if (!isRepoRelative(entry.dir)) throw contractError(rel, `surfaces[${index}].dir must be a repo-relative folder`);
  if (entry.input !== undefined && entry.input !== 'intents' && entry.input !== 'stick') throw contractError(rel, `surfaces[${index}].input must be "intents" or "stick"`);
  if (entry.intentFile !== undefined && (!isRepoRelative(entry.intentFile) || !entry.intentFile.endsWith('.ts'))) throw contractError(rel, `surfaces[${index}].intentFile must be a repo-relative .ts file`);
  if (entry.intentExport !== undefined && (typeof entry.intentExport !== 'string' || !CAMEL.test(entry.intentExport))) throw contractError(rel, `surfaces[${index}].intentExport must be a camelCase function name`);
  if (entry.tappable !== undefined && typeof entry.tappable !== 'boolean') throw contractError(rel, `surfaces[${index}].tappable must be true or false`);
  return { ...entry, dir: clean(entry.dir), ...(entry.intentFile === undefined ? {} : { intentFile: clean(entry.intentFile) }) };
}

/** The validated contract, or the defaults when the repo has none. A malformed contract is bad input (exit 2). */
export function readContract(root, layout) {
  const rel = `${layout.contractsDir}/${CONTRACT_NAME}`;
  if (!existsSync(join(root, rel))) return { file: rel, exists: false, surfaces: [], buttonComponents: [], gestureExempt: [] };
  let data;
  try {
    data = parseJsonc(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    throw contractError(rel, `not valid JSON: ${error.message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw contractError(rel, 'must be a JSON object');
  const extra = Object.keys(data).filter((key) => !CONTRACT_KEYS.has(key));
  if (extra.length > 0) throw contractError(rel, `unknown keys: ${extra.join(', ')}`);
  if (data.surfaces !== undefined && !Array.isArray(data.surfaces)) throw contractError(rel, '"surfaces" must be an array');
  const surfaces = (data.surfaces ?? []).map((entry, index) => validateSurface(rel, entry, index));
  const seen = new Set();
  for (const surface of surfaces) {
    if (seen.has(surface.id) || seen.has(surface.dir)) throw contractError(rel, `surface ${surface.id} repeats an id or a folder (one surface per folder)`);
    seen.add(surface.id);
    seen.add(surface.dir);
  }
  return {
    file: rel,
    exists: true,
    surfaces,
    buttonComponents: stringList(rel, data.buttonComponents, 'buttonComponents', PASCAL),
    gestureExempt: stringList(rel, data.gestureExempt, 'gestureExempt').map(clean),
  };
}

function configList(config, key) {
  const value = config[key];
  if (value === undefined) return null;
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || !list.every(isRepoRelative)) {
    throw new UsageError(`rn-skills.config.json "${key}" must be a repo-relative folder or a list of them`, `Fix "${key}" in rn-skills.config.json, e.g. "${key}": "src/canvas".`);
  }
  return list.map(clean);
}

function optionList(value, what) {
  const list = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  for (const entry of list) if (!isRepoRelative(entry)) throw new UsageError(`${what} ${entry} must be repo-relative`, `Pass a folder relative to the repo root, e.g. ${what} src/canvas.`);
  return list.map(clean);
}

/** Folders on disk (from the repo walk) whose path matches one of the globs. */
function foldersMatching(files, globs) {
  const dirs = new Set();
  for (const rel of files) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  const res = globs.map((glob) => ({ glob, re: globToRegExp(glob) }));
  return { all: [...dirs].sort(), matching: (re) => [...dirs].filter((dir) => re.test(dir)).sort(), res };
}

/**
 * The surface's intent file and export: the contract's, else <dir>/intent-to-action.ts (intentToAction), or
 * <dir>/intent-to-move.ts (intentToMove) for a game surface (src/games/<game-id>/canvas). The function lives
 * in the surface folder beside to-view.ts, also for games: game rules may import only src/core and their
 * own folders, so they cannot see the CanvasIntent type.
 */
function intentOf(surface, declared) {
  const isGame = GAMES_SURFACE.test(surface.dir);
  const file = declared?.intentFile ?? `${surface.dir}/${isGame ? 'intent-to-move.ts' : 'intent-to-action.ts'}`;
  const name = declared?.intentExport ?? (isGame && declared?.intentFile === undefined ? 'intentToMove' : 'intentToAction');
  return { file, name };
}

/**
 * Where the canvas input code lives:
 *   { root, layout, targets: [{ dir, layout }], contract, packages, hasRngh, rnghSpec, kitDirs, gestureDirs,
 *     featuresDirs, appSourceDirs, files, sources,
 *     surfaces: [{ id, dir, featureDir, declared, interactive, input, tappable, intent: { file, name } }],
 *     isAppSource(rel), isKit(rel), isExempt(rel), isGestureModule(rel), read(rel), targetOf(rel), gestureDirOf(rel) }
 * `targets` are the workspaces (one entry with dir '' for a single app); targetOf(rel).layout.aliases resolves
 * a file's `@/` imports through its own workspace's tsconfig.json. isGestureModule matches only the resolved
 * <gesturesDir>/use-canvas-gestures.ts: a copy forked into a feature is an ordinary file there.
 * options: { kitDir?, gesturesDir?, surfaceDirs? } (command-line options win over rn-skills.config.json).
 */
export function inputScope(root, options = {}) {
  if (!existsSync(join(root, 'package.json'))) {
    throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root, or pass it as the first argument.');
  }
  const layout = resolveLayout(root);
  const targets = layout.mode === 'monorepo' ? layout.workspaces.map((ws) => ({ dir: ws.dir, layout: ws.layout })) : [{ dir: '', layout }];
  const kitOption = optionList(options.kitDir, '--kit-dir');
  const kitDirs = kitOption.length > 0 ? kitOption : (configList(layout.config, 'canvasKitDir') ?? targets.map((t) => `${t.layout.srcDir}/canvas`));
  const gesturesOption = optionList(options.gesturesDir, '--gestures-dir');
  const gestureDirs = gesturesOption.length > 0 ? gesturesOption : (configList(layout.config, 'canvasGesturesDir') ?? kitDirs.map((dir) => `${dir}/gestures`));
  const contract = readContract(root, layout);
  const packages = declaredPackages(root, layout);
  const appSourceDirs = [...new Set(targets.flatMap((t) => [t.layout.srcDir, t.layout.routesDir]))];
  const isAppSource = (rel) => appSourceDirs.some((dir) => rel.startsWith(`${dir}/`));
  const files = walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] });
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) cache.set(rel, existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
    return cache.get(rel);
  };
  const sources = files.filter((rel) => isAppSource(rel) && !isTestFile(rel));

  const surfaceOption = optionList(options.surfaceDirs, '--surface-dir');
  const configuredGlobs = surfaceOption.length > 0 ? surfaceOption : (configList(layout.config, 'canvasSurfaceDirs') ?? []);
  const conventional = targets.flatMap((t) => [`${t.layout.featuresDir}/*/canvas`, `${t.layout.srcDir}/games/*/canvas`]);
  const globs = configuredGlobs.length > 0 ? configuredGlobs : conventional;
  const folders = foldersMatching(files, globs);
  const isKit = (dir) => kitDirs.some((kit) => isInside(dir, kit));
  const found = new Set();
  for (const { glob, re } of folders.res) {
    const hits = folders.matching(re).filter((dir) => !isKit(dir));
    if (hits.length === 0 && configuredGlobs.includes(glob)) {
      throw new UsageError(
        `the surface glob ${glob} matches no surface folder on disk (kit folders ${kitDirs.join(', ')} never count)`,
        'Fix "canvasSurfaceDirs" in rn-skills.config.json (or --surface-dir) so it names the folders that hold layout-<id>.ts and <id>-surface.ts, e.g. "src/features/*/canvas".',
      );
    }
    for (const dir of hits) found.add(dir);
  }
  for (const surface of contract.surfaces) {
    if (!isDir(join(root, surface.dir))) {
      throw new UsageError(`${contract.file}: surface ${surface.id} names the folder ${surface.dir}, which does not exist`, `Point "dir" at the surface folder, or remove the entry from ${contract.file}.`);
    }
    found.add(surface.dir);
  }

  const featureSources = (featureDir) => sources.filter((rel) => isInside(rel, featureDir));
  const surfaces = [...found].sort().map((dir) => {
    const declared = contract.surfaces.find((entry) => entry.dir === dir) ?? null;
    const featureDir = posix.dirname(dir);
    const feature = featureSources(featureDir);
    const callsGestures = feature.some((rel) => /\buseCanvasGestures\s*\(/.test(read(rel) ?? ''));
    const callsStick = feature.some((rel) => /\bmakeStickGesture\s*\(/.test(read(rel) ?? ''));
    const hasSim = isDir(join(root, featureDir, 'sim'));
    const intent = intentOf({ dir }, declared);
    const input = declared?.input ?? (hasSim || (callsStick && !callsGestures) ? 'stick' : 'intents');
    const layouts = files.filter((rel) => posix.dirname(rel) === dir && /^layout[^/]*\.ts$/.test(posix.basename(rel)) && !isTestFile(rel));
    const hasRegions = layouts.some((rel) => /\bfitGrid\s*\(|\bregions\s*:\s*\[\s*\{/.test(read(rel) ?? ''));
    const surfaceFile = files.find((rel) => posix.dirname(rel) === dir && /-surface\.ts$/.test(rel) && !isTestFile(rel));
    return {
      id: declared?.id ?? (surfaceFile === undefined ? posix.basename(featureDir) : posix.basename(surfaceFile).replace(/-surface\.ts$/, '')),
      dir,
      featureDir,
      declared: declared !== null,
      interactive: declared !== null || existsSync(join(root, intent.file)) || callsGestures || callsStick,
      input,
      tappable: declared?.tappable ?? hasRegions,
      intent,
    };
  });

  const rngh = packages.get(RNGH_PACKAGE) ?? null;
  const exemptRes = contract.gestureExempt.map((glob) => glob);
  // The workspace a file belongs to (its own layout and tsconfig aliases); the first one for a file
  // outside every workspace (a shared kit passed with --kit-dir, the repo root).
  const targetOf = (rel) => targets.find((t) => t.dir === '' || isInside(rel, t.dir)) ?? targets[0];
  const gestureDirOf = (rel) => {
    const index = targets.indexOf(targetOf(rel));
    return gestureDirs[Math.max(0, Math.min(index, gestureDirs.length - 1))];
  };
  return {
    root,
    layout,
    targets,
    contract,
    packages,
    hasRngh: rngh !== null,
    rnghSpec: rngh?.spec ?? null,
    kitDirs,
    gestureDirs,
    appSourceDirs,
    files,
    sources,
    surfaces,
    isAppSource,
    isKit: (rel) => isKit(rel),
    isExempt: (rel) => exemptRes.some((glob) => matchGlob(rel, glob)),
    isGestureModule: (rel) => gestureDirs.some((dir) => rel === `${dir}/${GESTURE_MODULE}`),
    featuresDirs: [...new Set(targets.map((t) => t.layout.featuresDir))],
    read,
    targetOf,
    gestureDirOf,
  };
}
