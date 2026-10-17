// Shared plumbing for the maintainer tools: where things live (the repo, skills/, tools/shared/,
// tools/standard.json), which folders are skills, and the assets/shared.json manifest (read,
// compare, sync). Maintainer-only; skills never import this.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError, toPosix, walk } from '../shared/scripts/check-lib.mjs';

export const TOOLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(TOOLS_DIR, '..');
export const DEFAULT_SKILLS_ROOT = join(REPO_ROOT, 'skills');
export const DEFAULT_SHARED = join(TOOLS_DIR, 'shared');
export const STANDARD_PATH = join(TOOLS_DIR, 'standard.json');
export const CATALOG_PATH = join(TOOLS_DIR, 'catalog.json');
export const STACK_PATH = join(TOOLS_DIR, 'stack.json');
export const MANIFEST_PATH = 'assets/shared.json';

/** Options every maintainer tool that works on skills accepts (for tests, installed copies and unusual layouts). */
export const COMMON_OPTIONS = {
  'skills-root': { type: 'string', value: 'dir', help: 'Folder that holds the skill folders (default: <repo>/skills)' },
  shared: { type: 'string', value: 'dir', help: 'Canonical shared folder (default: <repo>/tools/shared)' },
};

/** Read a JSON file the tools depend on; a missing or broken file is bad input (exit 2). */
export function readJson(path, what = path) {
  if (!existsSync(path)) throw new UsageError(`${what} does not exist`, `Restore ${toPosix(relative(REPO_ROOT, path)) || path}.`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${error.message}`, 'Fix the JSON.');
  }
}

/** The standard's constants (tools/standard.json, or another file for tests and other libraries). */
export function loadStandard(path = STANDARD_PATH) {
  const data = readJson(resolve(path), `standard file ${path}`);
  for (const key of ['frontmatter', 'names', 'description', 'skillMd', 'layout', 'projectRefs', 'runtimeEnv', 'device', 'scripts', 'fixtures', 'repo']) {
    if (!data[key] || typeof data[key] !== 'object') throw new UsageError(`standard file ${path} has no "${key}" object`, 'Compare it with tools/standard.json.');
  }
  return data;
}

export function resolveRoots(options) {
  const skillsRoot = resolve(options['skills-root'] ?? DEFAULT_SKILLS_ROOT);
  if (!existsSync(skillsRoot) || !statSync(skillsRoot).isDirectory()) {
    throw new UsageError(`skills root ${skillsRoot} does not exist`, 'Pass --skills-root <dir> pointing at the folder that holds the skill folders.');
  }
  const shared = resolve(options.shared ?? DEFAULT_SHARED);
  return { repoRoot: REPO_ROOT, toolsDir: TOOLS_DIR, skillsRoot, shared };
}

/**
 * Skill folders: every direct child of the skills root that is a folder (or a link to one). Nothing
 * else is skipped, so a stray "_library/" or ".hidden/" folder is validated (and fails) like any skill.
 */
export function listSkillDirs(skillsRoot) {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(skillsRoot, entry.name), { throwIfNoEntry: false })?.isDirectory()))
    .map((entry) => ({ name: entry.name, dir: join(skillsRoot, entry.name), kind: 'skill' }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The default target set of a maintainer tool: every skill folder under the skills root. */
export function defaultTargets(roots) {
  return listSkillDirs(roots.skillsRoot);
}

/** Turn command-line skill arguments (names or paths) into targets. */
export function resolveTargets(args, roots) {
  return args.map((arg) => {
    const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
    const looksLikePath = arg.includes('/') || arg === '.' || arg === '..';
    if (!looksLikePath && isDir(join(roots.skillsRoot, arg))) return { name: arg, dir: join(roots.skillsRoot, arg), kind: 'skill' };
    const asPath = resolve(arg);
    if (isDir(asPath)) return { name: basename(asPath), dir: asPath, kind: 'path' };
    throw new UsageError(`"${arg}" is not a skill folder name or path`, `Pass a folder name under ${roots.skillsRoot} or a path to a skill folder.`);
  });
}

/** Display name for a target. */
export function targetLabel(target) {
  return target.name;
}

/** Where a path sits for messages and annotations: repo-relative when inside the repo, else absolute. */
export function displayPath(path) {
  const rel = toPosix(relative(REPO_ROOT, path));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : toPosix(path);
}

// ---------------------------------------------------------------------------------------------
// assets/shared.json
// ---------------------------------------------------------------------------------------------

function badPath(path) {
  return typeof path !== 'string' || path === '' || isAbsolute(path) || path.includes('\\') || path.split('/').includes('..') || path.split('/').includes('.');
}

/**
 * Read and validate a skill's manifest.
 * Format: [ { "from": "<path under the shared folder>", "to": "<path inside the skill>" }, ... ]
 * A folder entry ends both paths with "/" and mirrors the whole folder.
 * Returns { exists, entries, errors: [message] }.
 */
export function readManifest(skillDir, sharedDir) {
  const path = join(skillDir, MANIFEST_PATH);
  if (!existsSync(path)) return { exists: false, entries: [], errors: [] };
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { exists: true, entries: [], errors: [`not valid JSON: ${error.message}`] };
  }
  if (!Array.isArray(data)) return { exists: true, entries: [], errors: ['must be a JSON array of { "from": ..., "to": ... } objects'] };
  const entries = [];
  const errors = [];
  const seen = new Set();
  data.forEach((item, index) => {
    const at = `entry ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${at} must be an object with "from" and "to"`);
      return;
    }
    const extra = Object.keys(item).filter((key) => key !== 'from' && key !== 'to');
    if (extra.length) errors.push(`${at} has unknown keys: ${extra.join(', ')}`);
    const { from, to } = item;
    if (badPath(from)) {
      errors.push(`${at}: "from" must be a relative path under the shared folder without "..": ${JSON.stringify(from)}`);
      return;
    }
    if (badPath(to)) {
      errors.push(`${at}: "to" must be a relative path inside the skill without "..": ${JSON.stringify(to)}`);
      return;
    }
    const isDir = from.endsWith('/');
    if (isDir !== to.endsWith('/')) {
      errors.push(`${at}: a folder entry ends both "from" and "to" with "/"; a file entry ends neither`);
      return;
    }
    const src = join(sharedDir, from);
    if (!existsSync(src)) {
      errors.push(`${at}: ${from} does not exist in the shared folder`);
      return;
    }
    if (isDir !== statSync(src).isDirectory()) {
      errors.push(`${at}: ${from} is ${statSync(src).isDirectory() ? 'a folder (end both paths with "/")' : 'a file (remove the trailing "/")'}`);
      return;
    }
    const target = to.replace(/\/$/, '');
    if (target === 'SKILL.md' || target === MANIFEST_PATH || (isDir && MANIFEST_PATH.startsWith(`${target}/`))) {
      errors.push(`${at}: "to" must not overwrite SKILL.md, the assets folder or ${MANIFEST_PATH}`);
      return;
    }
    if (seen.has(target)) {
      errors.push(`${at}: "to" ${to} is used twice`);
      return;
    }
    seen.add(target);
    entries.push({ from, to, isDir });
  });
  return { exists: true, entries, errors };
}

/** Expected files for the manifest: [{ src, rel }] where rel is the path inside the skill. */
export function expandEntries(entries, sharedDir) {
  const files = [];
  for (const entry of entries) {
    if (!entry.isDir) {
      files.push({ src: join(sharedDir, entry.from), rel: entry.to, entry });
      continue;
    }
    for (const rel of walk(join(sharedDir, entry.from), { defaultIgnores: false, ignore: ['.DS_Store'] })) {
      files.push({ src: join(sharedDir, entry.from, rel), rel: posix.join(entry.to, rel), entry });
    }
  }
  return files;
}

function sameBytes(a, b) {
  if (!existsSync(b) || !statSync(b).isFile()) return false;
  const left = readFileSync(a);
  const right = readFileSync(b);
  return left.length === right.length && left.equals(right);
}

/** Compare a skill's copies with the canonical files. Returns [{ rel, kind: 'missing'|'drift'|'extra', from }]. */
export function compareShared(skillDir, entries, sharedDir) {
  const findings = [];
  const expected = expandEntries(entries, sharedDir);
  const expectedRels = new Set(expected.map((file) => file.rel));
  for (const file of expected) {
    const dest = join(skillDir, file.rel);
    if (!existsSync(dest)) findings.push({ rel: file.rel, kind: 'missing', from: toPosix(relative(sharedDir, file.src)) });
    else if (!sameBytes(file.src, dest)) findings.push({ rel: file.rel, kind: 'drift', from: toPosix(relative(sharedDir, file.src)) });
  }
  for (const entry of entries.filter((item) => item.isDir)) {
    const destDir = join(skillDir, entry.to);
    if (!existsSync(destDir)) continue;
    for (const rel of walk(destDir, { defaultIgnores: false, ignore: ['.DS_Store'] })) {
      const full = posix.join(entry.to, rel);
      if (!expectedRels.has(full)) findings.push({ rel: full, kind: 'extra', from: entry.from });
    }
  }
  return findings;
}

/** Copy the canonical files into the skill and remove extra files from mirrored folders. */
export function syncShared(skillDir, entries, sharedDir) {
  const result = { copied: [], unchanged: 0, removed: [] };
  for (const file of expandEntries(entries, sharedDir)) {
    const dest = join(skillDir, file.rel);
    if (sameBytes(file.src, dest)) {
      result.unchanged += 1;
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file.src, dest);
    result.copied.push(file.rel);
  }
  for (const finding of compareShared(skillDir, entries, sharedDir).filter((item) => item.kind === 'extra')) {
    rmSync(join(skillDir, finding.rel), { force: true });
    result.removed.push(finding.rel);
  }
  return result;
}
