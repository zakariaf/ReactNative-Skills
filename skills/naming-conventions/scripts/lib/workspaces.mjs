// workspaces.mjs: the app repo's packages, read from package.json "workspaces" (a helper, not an
// entry point). A single-app repo (the default layout) has no workspaces: listApps() then returns
// the repo root itself, so a checker can loop over "every app" the same way in both layouts.
//
//   workspacePackages(root)        [{ dir, name, manifest }] for every workspace with a package.json,
//                                  from the "workspaces" globs (npm/yarn/pnpm style, "!x" excludes)
//   workspacePackageNames(root)    their package names, longest first ("@acme/ui-kit" before "@acme/ui")
//   listApps(root)                 the workspaces, or [{ dir: '.', name, manifest, isRoot: true }]
//   workspaceOf(rel, workspaces)   the workspace a repo-relative path lies in (longest dir), or null
//   isExpoApp(root, dir)           true when the folder holds app.config.(ts|js) or app.json, or
//                                  depends on expo
//
// Changed from the older copy: workspaces come from package.json, never from fixed packages/* and
// apps/* folders (a repo without a "workspaces" field has none).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readWorkspaces } from '../check-lib.mjs';

/** [{ dir: 'packages/ui', name: '@acme/ui', manifest }] for every workspace with a package.json, sorted by dir. */
export function workspacePackages(root) {
  return readWorkspaces(root);
}

/** The workspace package names, longest first, so "@acme/ui-kit" matches before "@acme/ui". */
export function workspacePackageNames(root) {
  return workspacePackages(root)
    .map((entry) => entry.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every app or package a checker should visit: the workspaces of a monorepo, or the repo root itself
 * for a single-app repo ({ dir: '.', name, manifest, isRoot: true }).
 */
export function listApps(root) {
  const workspaces = workspacePackages(root);
  if (workspaces.length > 0) return workspaces.map((entry) => ({ ...entry, isRoot: false }));
  const manifest = readManifest(join(root, 'package.json'));
  return [{ dir: '.', name: typeof manifest?.name === 'string' ? manifest.name : '', manifest, isRoot: true }];
}

/** The workspace (from workspacePackages or listApps) a repo-relative posix path lies in, or null. */
export function workspaceOf(rel, workspaces) {
  let best = null;
  for (const entry of workspaces ?? []) {
    if (entry.dir === '.') {
      if (best === null) best = entry;
      continue;
    }
    if ((rel === entry.dir || rel.startsWith(`${entry.dir}/`)) && (best === null || best.dir === '.' || entry.dir.length > best.dir.length)) best = entry;
  }
  return best;
}

/** True when the folder (repo-relative, '.' for the root) is an Expo app: an app config, or a dependency on expo. */
export function isExpoApp(root, dir = '.') {
  const folder = join(root, dir);
  if (['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'].some((name) => existsSync(join(folder, name)))) return true;
  const manifest = readManifest(join(folder, 'package.json'));
  return Boolean(manifest?.dependencies?.expo ?? manifest?.devDependencies?.expo);
}
