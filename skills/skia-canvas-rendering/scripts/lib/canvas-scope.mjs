// canvas-scope.mjs: where this skill's checkers look (a helper, not an entry point).
// The kit folder, the surface folders and the declared packages come from check-lib's
// resolveLayout (the canonical single-app layout, tsconfig paths, package.json workspaces,
// rn-skills.config.json), per-script options, and the repo-owned contract contracts/canvas-surfaces.json.
//
// rn-skills.config.json keys this skill reads (all optional):
//   "canvasKitDir":      "src/canvas"                          the kit folder (repo-relative)
//   "canvasSurfaceDirs": ["src/features/*/canvas", ...]        globs of surface folders (repo-relative);
//                                                              "**/canvas" works (walked from the repo root)
//   "contrastContract":  "contracts/contrast.json"             accessibility-as-code's contrast contract; read by
//                                                              check-canvas-files only for contrast-declared-once
// A folder that is (or lies inside) a kit folder or the goldens folder is never a surface, and a
// configured glob (option or config key) that matches no surface folder is bad input (exit 2).
//
// contracts/canvas-surfaces.json keys: paletteSets, goldensDir, surfaces [{ id, dir, kind, opaque }] and
// staticCanvases (app files whose <Canvas> is static art recorded once, outside any surface folder).

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { globToRegExp, parseJsonc, resolveLayout, UsageError, walkRepo } from '../check-lib.mjs';

export const SKIA_PACKAGE = '@shopify/react-native-skia';
export const CONTRACT_NAME = 'canvas-surfaces.json';
export const DEFAULT_PALETTE_SETS = Object.freeze(['light', 'dark']);
export const DEFAULT_GOLDENS_DIR = 'test/goldens/canvas';

const CONTRACT_KEYS = new Set(['$schema', '$comment', 'paletteSets', 'goldensDir', 'surfaces', 'staticCanvases']);
const SURFACE_KEYS = new Set(['id', 'dir', 'kind', 'opaque']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SET_NAME = /^[a-z][A-Za-z0-9]*$/;

const isRepoRelative = (value) =>
  typeof value === 'string' && value.trim() !== '' && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes('..');
const clean = (dir) => posix.normalize(dir.replace(/\\/g, '/')).replace(/\/$/, '');
const isInside = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);

function readJson(root, rel, what) {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON (${what}): ${error.message}`, `Fix the JSON in ${rel}.`);
  }
}

/** Every package name the repo declares: the root package.json and each workspace's. */
function declaredPackages(root, layout) {
  const names = new Set();
  const manifests = ['package.json', ...layout.workspaces.map((ws) => `${ws.dir}/package.json`)];
  for (const rel of manifests) {
    if (!existsSync(join(root, rel))) continue;
    const pkg = readJson(root, rel, 'a package manifest');
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg?.[key] ?? {})) names.add(name);
    }
  }
  return names;
}

const contractFix = (rel) =>
  `Write ${rel} as { "paletteSets": ["light", "dark"], "surfaces": [{ "id": "progress-grid", "dir": "src/features/tasks/canvas", "kind": "timeline" }], "staticCanvases": [] } (see canvas-surfaces.schema.json in this skill's templates/contracts).`;

function contractError(rel, message) {
  return new UsageError(`${rel}: ${message}`, contractFix(rel));
}

function validateSurfaces(rel, surfaces) {
  if (!Array.isArray(surfaces)) throw contractError(rel, '"surfaces" must be an array');
  const seen = new Set();
  return surfaces.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw contractError(rel, `surfaces[${index}] must be an object`);
    const extra = Object.keys(entry).filter((key) => !SURFACE_KEYS.has(key));
    if (extra.length > 0) throw contractError(rel, `surfaces[${index}] has unknown keys: ${extra.join(', ')}`);
    if (typeof entry.id !== 'string' || !KEBAB.test(entry.id)) throw contractError(rel, `surfaces[${index}].id must be a kebab-case id`);
    if (!isRepoRelative(entry.dir)) throw contractError(rel, `surfaces[${index}].dir must be a repo-relative folder`);
    if (entry.kind !== undefined && entry.kind !== 'timeline' && entry.kind !== 'live') throw contractError(rel, `surfaces[${index}].kind must be "timeline" or "live"`);
    if (entry.opaque !== undefined && typeof entry.opaque !== 'boolean') throw contractError(rel, `surfaces[${index}].opaque must be true or false`);
    const dir = clean(entry.dir);
    if (seen.has(entry.id) || seen.has(dir)) throw contractError(rel, `surfaces[${index}] repeats an id or a folder (one surface per folder)`);
    seen.add(entry.id);
    seen.add(dir);
    return { id: entry.id, dir, kind: entry.kind ?? 'timeline', opaque: entry.opaque ?? true, declared: true };
  });
}

function validatePaletteSets(rel, sets) {
  if (sets === undefined) return [...DEFAULT_PALETTE_SETS];
  const isValid = Array.isArray(sets) && sets.length >= 2 && sets.every((set) => typeof set === 'string' && SET_NAME.test(set)) && new Set(sets).size === sets.length;
  if (!isValid || !sets.includes('light') || !sets.includes('dark')) {
    throw contractError(rel, '"paletteSets" must list unique camelCase set names, including "light" and "dark"');
  }
  return sets;
}

/** Repo-relative source files whose canvas is declared static art (exempt from canvas-outside-surface). */
function validateStaticCanvases(rel, files) {
  if (files === undefined) return [];
  const isValid = Array.isArray(files) && files.every((file) => isRepoRelative(file) && /\.[jt]sx?$/.test(file)) && new Set(files).size === files.length;
  if (!isValid) throw contractError(rel, '"staticCanvases" must list unique repo-relative source files (src/ui/brand-mark.tsx)');
  return files.map(clean);
}

/** The validated contract, or null when the repo has none. A malformed contract is bad input (exit 2). */
export function readContract(root, layout) {
  const rel = `${layout.contractsDir}/${CONTRACT_NAME}`;
  if (!existsSync(join(root, rel))) return { file: rel, exists: false, paletteSets: [...DEFAULT_PALETTE_SETS], goldensDir: null, surfaces: [], staticCanvases: [] };
  let data;
  try {
    data = parseJsonc(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    throw contractError(rel, `not valid JSON: ${error.message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw contractError(rel, 'must be a JSON object');
  const extra = Object.keys(data).filter((key) => !CONTRACT_KEYS.has(key));
  if (extra.length > 0) throw contractError(rel, `unknown keys: ${extra.join(', ')}`);
  if (data.goldensDir !== undefined && !isRepoRelative(data.goldensDir)) throw contractError(rel, '"goldensDir" must be a repo-relative folder');
  return {
    file: rel,
    exists: true,
    paletteSets: validatePaletteSets(rel, data.paletteSets),
    goldensDir: data.goldensDir === undefined ? null : clean(data.goldensDir),
    surfaces: data.surfaces === undefined ? [] : validateSurfaces(rel, data.surfaces),
    staticCanvases: validateStaticCanvases(rel, data.staticCanvases),
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

/**
 * Where the canvas code lives.
 *   { root, layout, contract, packages, hasSkia, kitDirs, goldensDir, surfaceGlobs, configuredGlobs, appSourceDirs,
 *     inScope(rel), kitOf(rel), surfaceDirOf(rel), surfaceAt(dir), isAppSource(rel), aliasesOf(rel) }
 * options: { kitDir?: string|string[], surfaceDirs?: string[], goldensDir?: string } (command-line options win over
 * rn-skills.config.json and the contract).
 */
export function canvasScope(root, options = {}) {
  if (!existsSync(join(root, 'package.json'))) {
    throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root, or pass it as the first argument.');
  }
  const layout = resolveLayout(root);
  const targets = layout.mode === 'monorepo' ? layout.workspaces.map((ws) => ({ dir: ws.dir, layout: ws.layout })) : [{ dir: '', layout }];
  const kitOption = optionList(options.kitDir, '--kit-dir');
  const kitDirs = kitOption.length > 0 ? kitOption : (configList(layout.config, 'canvasKitDir') ?? targets.map((t) => `${t.layout.srcDir}/canvas`));
  const surfaceOption = optionList(options.surfaceDirs, '--surface-dir');
  const contract = readContract(root, layout);
  const goldensDir = optionList(options.goldensDir, '--goldens-dir')[0] ?? contract.goldensDir ?? DEFAULT_GOLDENS_DIR;
  const conventional = targets.flatMap((t) => [`${t.layout.featuresDir}/*/canvas`, `${t.layout.srcDir}/games/*/canvas`]);
  const configuredGlobs = surfaceOption.length > 0 ? surfaceOption : (configList(layout.config, 'canvasSurfaceDirs') ?? []);
  const surfaceGlobs = [...new Set([...(configuredGlobs.length > 0 ? configuredGlobs : conventional), ...contract.surfaces.map((surface) => surface.dir)])];
  const kitRes = kitDirs.map((dir) => ({ dir, re: globToRegExp(dir) }));
  const surfaceRes = surfaceGlobs.map((glob) => globToRegExp(glob));
  const ancestors = (rel) => {
    const parts = rel.split('/');
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  };
  const kitOf = (rel) => kitRes.find(({ re }) => ancestors(rel).some((dir) => re.test(dir)))?.dir ?? null;
  /** A kit folder (or anything inside it) and the goldens folder are never surfaces, whatever a glob says. */
  const isExcluded = (dir) => kitRes.some(({ re }) => ancestors(`${dir}/x`).some((part) => re.test(part))) || isInside(dir, goldensDir);
  const isSurfaceDir = (dir) => !isExcluded(dir) && surfaceRes.some((re) => re.test(dir));
  const surfaceDirOf = (rel) => ancestors(rel).find(isSurfaceDir) ?? null;
  // App source: each target's srcDir and routesDir (a routes folder outside src/ is app code too).
  const appSourceDirs = [...new Set(targets.flatMap((t) => [t.layout.srcDir, t.layout.routesDir]))];
  const aliasesOf = (rel) => {
    const ws = layout.workspaces.find((entry) => rel.startsWith(`${entry.dir}/`));
    return ws === undefined ? layout.aliases : ws.layout.aliases;
  };
  const packages = declaredPackages(root, layout);
  return {
    root,
    layout,
    contract,
    packages,
    hasSkia: packages.has(SKIA_PACKAGE),
    kitDirs,
    goldensDir,
    surfaceGlobs,
    configuredGlobs,
    appSourceDirs,
    isSurfaceDir,
    inScope: (rel) => kitOf(rel) !== null || surfaceDirOf(rel) !== null,
    kitOf,
    surfaceDirOf,
    surfaceAt: (dir) => contract.surfaces.find((surface) => surface.dir === dir) ?? null,
    isAppSource: (rel) => appSourceDirs.some((dir) => rel.startsWith(`${dir}/`)),
    aliasesOf,
  };
}

/**
 * Folders on disk that match a surface glob, found through the repo walk (so installed skills,
 * node_modules, generated native folders and build output are never surfaces). Globs without a
 * fixed prefix ("**\/canvas") work. A configured glob that matches no surface folder is bad input:
 * a silent "0 surfaces" pass would hide every surface the glob was meant to find.
 */
export function surfaceFolders(root, scope) {
  const dirs = new Set();
  for (const rel of walkRepo(root)) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  const found = [...dirs].filter((dir) => scope.isSurfaceDir(dir)).sort();
  for (const glob of scope.configuredGlobs) {
    const re = globToRegExp(glob);
    if (found.some((dir) => re.test(dir))) continue;
    throw new UsageError(
      `the surface glob ${glob} matches no surface folder on disk (kit folders ${scope.kitDirs.join(', ')} and the goldens folder ${scope.goldensDir} never count)`,
      'Fix "canvasSurfaceDirs" in rn-skills.config.json (or --surface-dir) so it names the folders that hold draw-<id>.ts and <id>-surface.ts, e.g. "src/features/*/canvas" or "**/canvas".',
    );
  }
  return found;
}
