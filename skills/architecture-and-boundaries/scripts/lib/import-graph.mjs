// import-graph.mjs: reads every TypeScript and JavaScript file of the app's code folders (src/, test/,
// __mocks__/, scripts/, plugins/, app.config.ts; root config files such as babel.config.js and
// metro.config.js are left out), extracts its imports and resolves
// each one to a repo file, an npm package or a Node built-in (no dependencies, no tsc). Relative paths,
// tsconfig "paths" aliases (per workspace) and workspace package names resolve the way Metro and
// TypeScript look files up (source-scan's resolveImport).

import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { extname, join, posix } from 'node:path';

import { walkRepo } from '../check-lib.mjs';
import { packageName } from './architecture.mjs';
import { importsOf, resolveImport, scanSource } from './source-scan.mjs';

const BUILTINS = new Set(builtinModules);

/**
 * True for node:fs, fs, fs/promises and the other Node built-ins. A bare name the importing workspace
 * declares in package.json (the buffer, events or url polyfills from npm) is that package, not Node's
 * module: `isDeclared(name)` answers it.
 */
export function isBuiltin(spec, isDeclared = () => false) {
  if (spec.startsWith('node:')) return true;
  const name = packageName(spec);
  return (BUILTINS.has(spec) || BUILTINS.has(name)) && !isDeclared(name);
}

// Metro picks an asset's scale variant (icon@2x.png) and platform variant (icon.ios.png) itself, so
// require('./icon.png') resolves when only those files exist.
const ASSET_SCALES = ['', '@1x', '@1.5x', '@2x', '@3x', '@4x'];
const ASSET_PLATFORMS = ['', '.ios', '.android', '.native', '.web'];

function assetVariant(root, rel) {
  const ext = posix.extname(rel);
  const stem = rel.slice(0, -ext.length);
  for (const platform of ASSET_PLATFORMS) {
    for (const scale of ASSET_SCALES) {
      const candidate = `${stem}${scale}${platform}${ext}`;
      if (existsSync(join(root, candidate))) return candidate;
    }
  }
  return null;
}

/**
 * Resolve one specifier written in `fromRel`:
 *   { kind: 'builtin', name } | { kind: 'package', name } | { kind: 'file', rel } | { kind: 'missing', rel }
 * options.isDeclared(name): the workspace declares this package; options.isAsset(spec): a Metro asset.
 */
export function resolveTarget(root, fromRel, spec, aliases, { isDeclared = () => false, isAsset = () => false } = {}) {
  if (isBuiltin(spec, isDeclared)) return { kind: 'builtin', name: spec.replace(/^node:/, '') };
  const resolved = resolveImport(fromRel, spec, { root, aliases });
  if (resolved.kind === 'external') return { kind: 'package', name: packageName(spec) };
  if (resolved.exists) return { kind: 'file', rel: resolved.path };
  const variant = isAsset(spec) ? assetVariant(root, resolved.path) : null;
  return variant ? { kind: 'file', rel: variant } : { kind: 'missing', rel: resolved.path };
}

/**
 * A JavaScript file directly in the repo root or in a workspace root: a tool config (babel.config.js,
 * metro.config.js, jest.config.js), CommonJS for Node, never app code. app.config.js is read (Node world).
 */
function isRootConfig(rel, arch) {
  if (!/\.jsx?$/.test(rel) || arch.classify(rel).zone === 'node') return false;
  const dir = posix.dirname(rel);
  return dir === '.' || [...arch.appScopes, ...arch.packageScopes].some((scope) => scope.dir === dir);
}

/**
 * Reads the repo's code: { nodes: Map<rel, { rel, text, scan, imports }>, files }. Each import is
 * { spec, line, form, typeOnly, target }. Only the architecture's code folders are read (TypeScript,
 * and JavaScript for apps with allowJs); installed skills and generated folders are never scanned (walkRepo).
 */
export function buildGraph(root, arch) {
  const files = walkRepo(root, { include: ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx'] }).filter((rel) => arch.isCodePath(rel) && !isRootConfig(rel, arch));
  const nodes = new Map();
  for (const rel of files) {
    const text = readFileSync(join(root, rel), 'utf8');
    const scan = scanSource(text);
    const aliases = arch.aliasesFor(rel);
    const options = { isDeclared: (name) => arch.dependsOn(rel, name), isAsset: arch.isAssetSpec };
    const imports = importsOf(scan).map((entry) => ({ ...entry, target: resolveTarget(root, rel, entry.spec, aliases, options) }));
    nodes.set(rel, { rel, text, scan, imports });
  }
  return { nodes, files };
}

/** Node's process global beyond the EXPO_PUBLIC_* values Metro inlines. */
const NODE_PROCESS = /(?<![\w$.])process\.(argv|exitCode|cwd|platform|exit|stdout|stderr)\b/;

/**
 * Does a file, or anything it imports inside the repo (type-only imports included: they still pull
 * the file into the app's TypeScript program), need Node? Returns the reason or null.
 */
export function reachesNodeWorld(graph, arch, startRel) {
  const seen = new Set();
  const stack = [startRel];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const info = arch.classify(rel);
    if (info.isNode) return `${rel} runs in Node`;
    const node = graph.nodes.get(rel);
    if (!node) continue;
    if (info.zone === 'config' && NODE_PROCESS.test(node.scan.code)) return `${rel} uses Node's process global`;
    for (const entry of node.imports) {
      if (entry.target.kind === 'builtin') return `${rel} imports node:${entry.target.name}`;
      if (entry.target.kind === 'package' && arch.settings.nodeWorldMarkers.includes(entry.spec)) return `${rel} imports ${entry.spec}`;
      if (entry.target.kind === 'file') stack.push(entry.target.rel);
    }
  }
  return null;
}

/**
 * Can Node load this app file and its value imports? Returns why not, or null. Node type-strips .ts
 * files only (no JSX), refuses to type-strip React Native and Expo module sources, ignores tsconfig
 * paths and resolves no extensions, so every file it reaches must import relatively with the extension.
 */
export function reachesAppRuntime(graph, arch, startRel) {
  const seen = new Set();
  const stack = [startRel];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (/\.[jt]sx$/.test(rel)) return `${rel} holds JSX`;
    const node = graph.nodes.get(rel);
    if (!node) continue;
    for (const entry of node.imports) {
      if (entry.typeOnly) continue;
      const { spec, target } = entry;
      if (target.kind === 'package' && arch.isRuntimePackage(spec)) return `${rel} imports ${spec}`;
      if (target.kind === 'builtin' || target.kind === 'package') continue;
      if (!spec.startsWith('.')) return `${rel} imports "${spec}" through a tsconfig alias`;
      if (extname(spec) === '') return `${rel} imports "${spec}" without its file extension`;
      if (target.kind === 'file') stack.push(target.rel);
    }
  }
  return null;
}

/** Cycles among value imports (type-only imports are erased, so they never form one): each once. */
export function findCycles(graph) {
  const cycles = [];
  const seenKeys = new Set();
  const state = new Map();
  const path = [];
  const visit = (rel) => {
    state.set(rel, 'active');
    path.push(rel);
    for (const entry of graph.nodes.get(rel)?.imports ?? []) {
      if (entry.typeOnly || entry.target.kind !== 'file' || !graph.nodes.has(entry.target.rel)) continue;
      const next = entry.target.rel;
      if (state.get(next) === 'active') {
        const cycle = path.slice(path.indexOf(next));
        const key = [...cycle].sort().join('|');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    path.pop();
    state.set(rel, 'done');
  };
  for (const rel of graph.nodes.keys()) if (!state.has(rel)) visit(rel);
  return cycles;
}
