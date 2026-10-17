// module-graph.mjs: what a source file loads, and every local file a set of files reaches (a helper of
// this skill's two checkers, not an entry point). Static imports and re-exports, side-effect imports,
// import() and require() are all seen; type-only imports are marked, because they are erased before
// the code runs and load nothing. Packages (node_modules) are never followed.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';

import { readWorkspaces, toPosix } from '../check-lib.mjs';
import { maskCode, resolveImport } from './source-scan.mjs';

/** True for `type X`, `type { A }` and `{ type A, type B }`: an import clause that names only types. */
function isTypeOnlyClause(clause) {
  const text = clause.trim();
  if (text === 'type') return false; // a default import that happens to be named `type`
  if (/^type\s/.test(text) || /^type\{/.test(text)) return true;
  const braces = /^\{([\s\S]*)\}$/.exec(text);
  if (!braces) return false;
  const names = braces[1].split(',').map((name) => name.trim()).filter(Boolean);
  return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

/**
 * Module specifiers a file loads, in source order:
 * [{ from, index, kind: 'static' | 'dynamic' | 'require', typeOnly }].
 * `index` is the offset of the `import` / `export` / `require` keyword (comments and strings are never
 * read as code). An import() call right after `typeof` (a type position) counts as type-only.
 */
export function moduleSpecifiers(source) {
  const masked = maskCode(source);
  const out = [];
  const keep = (index, keyword, entry) => {
    // Comments and strings are blanked in the masked copy: a keyword there is not code.
    if (masked.slice(index, index + keyword.length) === keyword) out.push({ ...entry, index });
  };
  for (const match of source.matchAll(/(^|[\n;])[ \t]*(import|export)\b([^;'"]*?)\bfrom\s*(['"])([^'"\n]+)\4/g)) {
    keep(match.index + match[0].indexOf(match[2], match[1].length), match[2], { from: match[5], kind: 'static', typeOnly: isTypeOnlyClause(match[3]) });
  }
  for (const match of source.matchAll(/(^|[\n;])[ \t]*(import)\s*(['"])([^'"\n]+)\3/g)) {
    keep(match.index + match[0].indexOf(match[2], match[1].length), match[2], { from: match[4], kind: 'static', typeOnly: false });
  }
  for (const match of source.matchAll(/(?<![\w$.])(import|require)\s*\(\s*(['"])([^'"\n]+)\2/g)) {
    const typeOnly = /\btypeof\s*$/.test(masked.slice(Math.max(0, match.index - 12), match.index));
    keep(match.index, match[1], { from: match[3], kind: match[1] === 'require' ? 'require' : 'dynamic', typeOnly });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The package a bare specifier names: 'uuid/v4' -> 'uuid', '@faker-js/faker/locale/en' -> '@faker-js/faker', 'node:crypto' stays. */
export function packageNameOf(spec) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return spec;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Every local file the `starts` reach through value imports, breadth first (the shortest chain wins):
 * Map<file, [start, ..., file]>. Only files for which `follow(rel)` is true are entered (the caller
 * passes the repo walk, so node_modules, installed skills and output folders stay out); the starts
 * themselves are not in the result. Imports resolve the way the app does: relative paths, tsconfig
 * `paths` aliases and workspace packages (resolveImport), never node_modules. `resolveOutside(spec)`
 * resolves a bare specifier resolveImport leaves to node_modules (a package of the enclosing workspaces
 * repo, when the root is one app folder of it) to a root-relative path, which may start with '../'.
 */
export function reachableFiles(root, starts, { aliases, follow, resolveOutside = () => null }) {
  const reached = new Map();
  const visited = new Set(starts);
  const queue = starts.map((start) => [start]);
  while (queue.length > 0) {
    const chain = queue.shift();
    const file = chain.at(-1);
    let source;
    try {
      source = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const { from, typeOnly } of moduleSpecifiers(source)) {
      if (typeOnly) continue;
      const resolved = resolveImport(file, from, { root, aliases });
      const path = resolved.kind === 'local' ? (resolved.exists ? resolved.path : null) : resolveOutside(from);
      if (typeof path !== 'string') continue;
      const target = posix.normalize(path);
      if (visited.has(target) || !follow(target)) continue;
      visited.add(target);
      reached.set(target, [...chain, target]);
      queue.push([...chain, target]);
    }
  }
  return reached;
}

/**
 * The workspaces repo an app folder belongs to: { dir (absolute), appDir (the root, relative to dir),
 * prefix (the parent steps back from the root to dir) }, or null when no parent package.json lists the root
 * in "workspaces" (a single-app repo, or the root is the workspace root itself).
 */
export function enclosingWorkspaceRoot(root) {
  const app = resolve(root);
  for (let dir = dirname(app), depth = 0; depth < 8 && dir !== dirname(dir); dir = dirname(dir), depth += 1) {
    if (!existsSync(join(dir, 'package.json'))) continue;
    const appDir = toPosix(relative(dir, app));
    if (readWorkspaces(dir).some((workspace) => workspace.dir === appDir)) return { dir, appDir, prefix: `${toPosix(relative(app, dir))}/` };
  }
  return null;
}

/**
 * For reachableFiles' `resolveOutside`: a bare specifier that names a package of the enclosing
 * workspaces repo ('@acme/shared/easing'), resolved to the file it loads, relative to the root
 * (packages/shared/src/easing.ts behind the parent steps of `prefix`); null for anything else.
 */
export function workspacePackageResolver(workspaceRoot) {
  if (workspaceRoot === null) return () => null;
  return (spec) => {
    const resolved = resolveImport('package.json', spec, { root: workspaceRoot.dir, aliases: [] });
    if (resolved.kind !== 'local' || !resolved.exists) return null;
    return posix.relative(workspaceRoot.appDir, resolved.path);
  };
}
