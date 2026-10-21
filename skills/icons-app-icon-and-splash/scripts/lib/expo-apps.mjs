// expo-apps.mjs: finds the Expo app(s) a checker run from a repo root covers (a helper, not an entry
// point). A single-app repo is its own app. In a workspace repo (package.json "workspaces") whose
// root is not an app, each Expo app workspace (apps/mobile) is checked as an app of its own, with
// every file its problems name shown from the repo root (apps/mobile/src/theme/palette.ts).
//
//   expoAppDirs(root)                ['.'] for a single app (or a root that is itself the app), else the
//                                    Expo app workspaces: ['apps/mobile'] (app config, else an expo dependency)
//   enclosingWorkspaceRepo(dir)      { root, prefix } when `dir` is a workspace of a repo further up
//                                    (prefix 'apps/mobile'), else null
//   importExtensionsMode(repoRoot)   'all' when relative and @/ imports write their extension (a workspace
//                                    repo, or rn-skills.config.json "importExtensions"), else 'node'
//   prefixedReporter(report, dir)    a reporter whose problem and skip files carry `dir/`
//   forEachExpoApp(root, report, check)  runs check(appRoot, appReport, dir) per app and sums the results
//
// It follows typescript-and-lint-rules' check-source for the extension mode, so a file a generator
// writes passes the lint the repo runs.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { PROJECT_CONFIG_FILE, UsageError, parseJsonc, readWorkspaces, toPosix } from '../check-lib.mjs';

export const APP_CONFIG_FILES = Object.freeze(['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json']);

function readJson(path) {
  try {
    return parseJsonc(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** True when the folder holds an Expo app config (app.config.* or app.json). */
export function hasAppConfig(root, dir = '.') {
  return APP_CONFIG_FILES.some((name) => existsSync(join(root, dir, name)));
}

/**
 * The repo-relative folders of the Expo apps a run from `root` covers. A repo without workspaces, or
 * whose root holds the app config, is one app ('.'). Otherwise every workspace with an app config is
 * an app; when none has one, every workspace that depends on expo; when none does, the root.
 */
export function expoAppDirs(root) {
  const workspaces = readWorkspaces(root);
  if (workspaces.length === 0 || hasAppConfig(root)) return ['.'];
  const configured = workspaces.filter((workspace) => hasAppConfig(root, workspace.dir)).map((workspace) => workspace.dir);
  if (configured.length > 0) return configured;
  const dependent = workspaces.filter((workspace) => Boolean(workspace.manifest?.dependencies?.expo)).map((workspace) => workspace.dir);
  return dependent.length > 0 ? dependent : ['.'];
}

/** The workspace repo `dir` belongs to, from the nearest folder above whose package.json "workspaces" lists it: { root, prefix }, or null. */
export function enclosingWorkspaceRepo(dir) {
  const target = resolve(dir);
  for (let parent = dirname(target); parent !== dirname(parent); parent = dirname(parent)) {
    if (!existsSync(join(parent, 'package.json'))) continue;
    const prefix = toPosix(relative(parent, target));
    if (readWorkspaces(parent).some((workspace) => workspace.dir === prefix)) return { root: parent, prefix };
  }
  return null;
}

/**
 * Which imports write their extension in the repo: rn-skills.config.json "importExtensions" when
 * set ('node' or 'all'), else 'all' for a workspace repo and 'node' for a single app.
 */
export function importExtensionsMode(repoRoot) {
  const configured = readJson(join(repoRoot, PROJECT_CONFIG_FILE))?.importExtensions;
  if (configured === 'node' || configured === 'all') return configured;
  return readWorkspaces(repoRoot).length > 0 ? 'all' : 'node';
}

/** A reporter that shows every problem and skip file from the repo root (`dir` '.' returns `report` itself). */
export function prefixedReporter(report, dir) {
  if (dir === '.' || dir === '') return report;
  const shown = (file) => (file ? `${dir}/${file}` : dir);
  return {
    get count() {
      return report.count;
    },
    problem: (entry) => report.problem({ ...entry, file: shown(entry.file) }),
    // Forwards the caller's SKIP unchanged but for its file, so it adds no SKIP line of its own.
    skip: (entry) => report.skip(Object.assign({}, entry, { file: shown(entry.file) })),
    note: (text) => report.note(text),
  };
}

/**
 * Runs `check(appRoot, appReport, dir)` once per Expo app (expoAppDirs) and sums what each returns:
 * { checked } for a checked app, { notApplicable: '<repo fact>' } for one the check does not apply
 * to. Bad input inside an app names the app. Returns { checked, notApplicable } where notApplicable
 * is set only when no app applies.
 */
export async function forEachExpoApp(root, report, check) {
  const dirs = expoAppDirs(root);
  if (dirs[0] !== '.') report.note(`apps: ${dirs.join(', ')} (the Expo app workspaces of package.json "workspaces"), each checked as an app`);
  let checked = 0;
  const notApplicable = [];
  for (const dir of dirs) {
    let result;
    try {
      result = await check(dir === '.' ? root : join(root, dir), prefixedReporter(report, dir), dir);
    } catch (error) {
      if (error instanceof UsageError && dir !== '.') throw new UsageError(`${dir}: ${error.message}`, error.fix);
      throw error;
    }
    if (typeof result?.notApplicable === 'string') {
      notApplicable.push(dir === '.' ? result.notApplicable : `${dir}: ${result.notApplicable}`);
      if (dirs.length > 1) report.note(`${dir}: not applicable (${result.notApplicable})`);
    } else checked += result?.checked ?? 0;
  }
  return { checked, notApplicable: notApplicable.length === dirs.length ? notApplicable.join('; ') : null };
}
