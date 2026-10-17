// app-scope.mjs: which repo paths are app code, and whether an ignore entry (ESLint PRE_EXISTING or
// globalIgnores, a .prettierignore line, a tsconfig exclude) covers any of it. Owned by
// typescript-and-lint-rules (not synced); check-configs.mjs and check-source.mjs both use it, so the
// two checkers agree on what may never be ignored.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { globToRegExp, matchGlob, walkRepo } from '../check-lib.mjs';

/** Code files ESLint lints or tsc type-checks. */
const CODE_GLOBS = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'];
const LAYOUT_KEYS = ['srcDir', 'routesDir', 'testDir', 'mocksDir', 'scriptsDir'];

/**
 * The top-level folders and files that hold app code: the layout folders (src/, test/, __mocks__/,
 * scripts/), the fixed names from the baseline (plugins/, app.config.ts, ...), every workspace folder
 * and every rn-skills.config.json "layoutEntries" item.
 */
export function appTops(layout, fixed = []) {
  const tops = new Set(fixed);
  for (const key of LAYOUT_KEYS) if (typeof layout[key] === 'string') tops.add(layout[key].split('/')[0]);
  for (const workspace of layout.workspaces ?? []) tops.add(workspace.dir.split('/')[0]);
  const entries = layout.config?.layoutEntries;
  for (const entry of Array.isArray(entries) ? entries : []) tops.add(String(entry).replace(/^\.?\/+|\/+$/g, '').split('/')[0]);
  tops.delete('');
  return tops;
}

const APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];

/** Whether a workspace is an Expo app whose ios/ and android/ prebuild generates: an app config, or expo
 * as a runtime dependency without expo-module.config.json (a local Expo module keeps expo in
 * devDependencies and commits its native source). */
function generatesNative(root, dir) {
  const folder = join(root, dir);
  if (APP_CONFIGS.some((name) => existsSync(join(folder, name)))) return true;
  if (existsSync(join(folder, 'expo-module.config.json'))) return false;
  try {
    return Boolean(JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))?.dependencies?.expo);
  } catch {
    return false;
  }
}

/** The workspace folders and, among them, the Expo apps whose native projects are generated. */
export function nativeScope(root, layout) {
  const workspaceDirs = (layout.workspaces ?? []).map((workspace) => workspace.dir);
  return { workspaceDirs, appDirs: workspaceDirs.filter((dir) => generatesNative(root, dir)) };
}

/**
 * True when an ignore entry names exactly the generated native projects of Expo app workspaces
 * (`apps/*\/ios/`, `apps/mobile/android`, `apps/*\/ios/**`): the multi-package form of the root `/ios/`
 * and `/android/`. Its folder part must match at least one workspace and only Expo app workspaces, so
 * `packages/*\/ios/` (a local native module's committed source) and `apps/**\/ios/` still fail.
 */
export function isWorkspaceNativeIgnore(entry, { workspaceDirs = [], appDirs = [] } = {}) {
  const match = /^(.+)\/(ios|android)(?:\/\*\*)?$/.exec(normalizeIgnore(entry));
  if (!match || match[1].includes('**')) return false;
  const pattern = globToRegExp(match[1]);
  const reached = workspaceDirs.filter((dir) => pattern.test(dir));
  return reached.length > 0 && reached.every((dir) => appDirs.includes(dir));
}

/** Repo-relative code files under the app tops (generated, native and agent folders left out). */
export function appFiles(root, tops) {
  const present = [...tops].filter((top) => existsSync(join(root, top)));
  if (present.length === 0) return [];
  return walkRepo(root, { include: CODE_GLOBS }).filter((rel) => tops.has(rel.split('/')[0]));
}

/** An ignore entry without ./, a leading / or trailing slashes ('/src/features/' -> 'src/features'). */
export function normalizeIgnore(entry) {
  return String(entry).trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** True when an anchored pattern (ESLint ignores, tsconfig exclude) matches the path or a folder above it. */
function anchoredMatch(rel, pattern) {
  return globToRegExp(pattern).test(rel) || globToRegExp(`${pattern}/**`).test(rel);
}

/**
 * Whether an ignore entry covers app code, or null. `style` is 'anchored' (ESLint flat-config ignores and
 * tsconfig exclude: a slashless name matches only at the root) or 'gitignore' (.prettierignore: a name
 * without an inner slash matches at any depth). `native` ({ workspaceDirs, appDirs }) lets a line that names
 * exactly an Expo app workspace's generated ios/ or android/ pass (isWorkspaceNativeIgnore). Returns
 * { reason, example }.
 */
export function coversAppCode(entry, { style, tops, files, native }) {
  const raw = String(entry).trim();
  const pattern = normalizeIgnore(raw);
  if (pattern === '' || /^\*\*?$/.test(pattern)) return { reason: 'matches every file', example: files[0] ?? null };
  if (native && isWorkspaceNativeIgnore(raw, native)) return null;
  const first = pattern.split('/')[0];
  if (tops.has(first)) return { reason: `${pattern === first ? 'is' : 'reaches into'} the app path ${first}`, example: files.find((rel) => anchoredMatch(rel, pattern)) ?? null };
  const unanchored = style === 'gitignore' && !raw.replace(/\/+$/, '').includes('/');
  const hit = files.find((rel) => (unanchored ? matchGlob(rel, pattern) : anchoredMatch(rel, pattern)));
  return hit === undefined ? null : { reason: `matches app files such as ${hit}`, example: hit };
}
