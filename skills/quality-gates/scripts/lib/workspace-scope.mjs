// workspace-scope.mjs: the "workspace form" of the canonical Jest scope, for a multi-package repo
// (package.json "workspaces"). The canonical scope names the single app's folders (<rootDir>/src/**/,
// src/**/*.{ts,tsx}, <rootDir>/(ios|android|...)/). In a workspace repo the same value is written once
// per workspace, with a workspace prefix where src/ or the ignored folder stood:
//   <rootDir>/apps/*/src/**/          <rootDir>/{apps,packages}/*/src/**/*.{ts,tsx}
//   <rootDir>/(apps|packages)/[^/]+/(ios|android|build|dist|web-build)/
// Stripping the recognised prefixes and dropping the repeats gives back the canonical value, so every
// other change (an added "!" glob, an ignored test path, a narrower suffix) still differs. The prefixes
// come from package.json "workspaces" and the workspace folders, never from a hard-coded list.

import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { globToRegExp } from '../check-lib.mjs';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The declared workspace patterns of package.json (an array, or yarn's { packages: [...] }). */
function declaredPatterns(pkg) {
  const value = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && !item.startsWith('!')) : [];
}

/**
 * Every prefix a workspace value may carry, longest first: [{ text, covers }] where covers lists the
 * workspace folders the prefix reaches. Literal folders (apps/mobile), each "<parent>/*" pattern in glob
 * and regex form (apps/*, apps/[^/]+), and the union of those parents ({apps,packages}/*,
 * (apps|packages)/[^/]+). [] for a single-app repo.
 */
export function workspacePrefixes(layout, pkg) {
  const dirs = layout.workspaces.map((workspace) => workspace.dir);
  if (dirs.length === 0) return [];
  const prefixes = new Map();
  const add = (text, covers) => {
    const known = prefixes.get(text) ?? new Set();
    for (const dir of covers) known.add(dir);
    prefixes.set(text, known);
  };
  for (const dir of dirs) add(dir, [dir]);
  const parents = declaredPatterns(pkg).map((pattern) => /^([\w.@-]+(?:\/[\w.@-]+)*)\/\*$/.exec(pattern)?.[1]).filter(Boolean);
  for (const parent of parents) {
    const covers = dirs.filter((dir) => dirname(dir) === parent);
    add(`${parent}/*`, covers);
    add(`${parent}/[^/]+`, covers);
  }
  if (parents.length > 1) {
    const covers = dirs.filter((dir) => parents.includes(dirname(dir)));
    for (const order of [parents, [...parents].sort()]) {
      add(`{${order.join(',')}}/*`, covers);
      add(`(${order.join('|')})/[^/]+`, covers);
    }
  }
  return [...prefixes].map(([text, covers]) => ({ text, covers: [...covers] })).sort((a, b) => b.text.length - a.text.length);
}

/** Top-level elements of an array literal's source ("[a,b]" -> ["a", "b"]), or null for anything else. */
function arrayElements(expression) {
  if (!expression.startsWith('[') || !expression.endsWith(']')) return null;
  const elements = [];
  let depth = 0;
  let start = 1;
  for (let i = 1; i < expression.length - 1; i += 1) {
    const ch = expression[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < expression.length && expression[i] !== ch; i += expression[i] === '\\' ? 2 : 1);
    } else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      elements.push(expression.slice(start, i));
      start = i + 1;
    }
  }
  const last = expression.slice(start, -1);
  if (last !== '') elements.push(last);
  return elements;
}

/**
 * The single-app form of a (whitespace-free) source expression or string: every recognised workspace
 * prefix right after "<rootDir>/" or at the start of a string ('!' kept) is removed, and an array
 * literal drops repeated elements. `onStrip(prefix, after)` is told each prefix removed and the text
 * that followed it ("src/...", "plugins/..."), so a caller can tell a src/ root from another folder.
 */
export function singleAppForm(expression, prefixes, onStrip = () => {}) {
  if (prefixes.length === 0) return expression;
  const byText = new Map(prefixes.map((prefix) => [prefix.text, prefix]));
  const pattern = new RegExp(`(<rootDir>/|['"\`]!?)(${prefixes.map((prefix) => escapeRegExp(prefix.text)).join('|')})/`, 'g');
  const stripped = expression.replace(pattern, (match, context, text, offset, whole) => {
    onStrip(byText.get(text), whole.slice(offset + match.length));
    return context;
  });
  const elements = arrayElements(stripped);
  return elements === null ? stripped : `[${[...new Set(elements)].join(',')}]`;
}

/** The single-app form of a list of strings (quality-gates.json data), repeats dropped. */
export function singleAppList(list, prefixes, onStrip) {
  if (!Array.isArray(list)) return list;
  return [...new Set(list.map((item) => (typeof item === 'string' ? singleAppForm(`'${item}'`, prefixes, onStrip).slice(1, -1) : item)))];
}

/** The workspace folders that hold a src/ folder: each must stay reachable by coverage and the tests. */
export function workspacesWithSource(root, layout) {
  return layout.workspaces.map((workspace) => workspace.dir).filter((dir) => existsSync(join(root, dir, 'src')));
}

/**
 * True when `key` (an app coverageThreshold key) stands for the baseline logic key `base`
 * ("./src/<name>/<rest>"): the same key, its workspace form ("./apps/*\/src/core/"), or the package
 * named <name> ("./packages/core/src/" for "./src/core/", "./packages/games/src/*\/rules/**\/*.ts").
 */
export function isLogicCounterpart(key, base, layout, pkg) {
  if (key === base) return true;
  const match = /^\.\/src\/([^/]+)\/(.*)$/.exec(base);
  if (!match) return false;
  const [, name, rest] = match;
  const prefixes = workspacePrefixes(layout, pkg);
  if (prefixes.some((prefix) => key === `./${prefix.text}/src/${name}/${rest}`)) return true;
  const parents = declaredPatterns(pkg).map((pattern) => /^(.+)\/\*$/.exec(pattern)?.[1]).filter(Boolean);
  const packageDirs = [...parents.map((parent) => `${parent}/${name}`), ...layout.workspaces.map((workspace) => workspace.dir).filter((dir) => basename(dir) === name)];
  return packageDirs.some((dir) => key === `./${dir}/src/${rest}`);
}

/**
 * A file path inside workspace `dir` that a baseline glob reaches in the single app: the baseline
 * "src/**\/*.android.test.{ts,tsx}" gives "<dir>/src/a/x.android.test.ts". null for a baseline glob
 * outside src/ (scripts/, test/ stay at the root).
 */
export function probeFor(dir, baselineGlob) {
  const rest = /^(?:<rootDir>\/)?src\/(.*)$/.exec(baselineGlob)?.[1];
  if (rest === undefined) return null;
  return `${dir}/src/${rest.replace(/\*\*\//g, 'a/').replace(/\{([^,}]+)[^}]*\}/g, '$1').replace(/\*/g, 'x')}`;
}

/** True when some positive glob of `list` ("<rootDir>/" stripped) reaches `file`. */
export function reaches(list, file) {
  return (Array.isArray(list) ? list : []).some((glob) => typeof glob === 'string' && !glob.startsWith('!') && globToRegExp(glob.replace(/^<rootDir>\//, '')).test(file));
}
