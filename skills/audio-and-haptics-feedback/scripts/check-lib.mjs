// check-lib.mjs: the shared helper every skill script imports (Node 22.18+, zero dependencies:
// node: built-ins only).
//
// Do not edit a skill's copy of this file. The library keeps one canonical copy and its sync tool
// copies it into every skill that declares it in assets/shared.json; the skill validator fails on
// any drift. Change the canonical copy, then re-sync.
//
// Exports, by section (each one has its own comment below):
//   Exit codes and errors  EXIT, RESULT_PATTERN, resultLine(n), UsageError, fail(message, fix), toPosix(path)
//   Arguments              parseArgs(argv, spec), helpText(spec): automatic --help (exit 0) and usage
//                          errors (exit 2). The repo root is an optional positional argument; a guessed
//                          --root is answered with the positional form.
//   Files                  globToRegExp, matchGlob, DEFAULT_IGNORES, walk(root, options) (ignore and
//                          include globs, pruneDirsContaining), AGENT_SKILL_FOLDERS, REPO_SCAN_IGNORES,
//                          repoScanIgnores(root), isRepoScanIgnored(rel, root), walkRepo(root, options)
//                          (every repo scan: the ignores plus any folder holding a SKILL.md),
//                          requireDir, requireFile
//   Layout                 LAYOUT_DEFAULTS, LAYOUT_KEYS, PROJECT_CONFIG_FILE, parseJsonc(text),
//                          readProjectConfig(root), readTsconfigPaths(root, file), resolveAlias(spec,
//                          aliases), readWorkspaces(root), resolveLayout(root, overrides)
//   Incremental adoption   notYetCreated(root, { file, owner }): the reason for a SKIP line, or null
//   Text                   isBinary, readText, lineOf, sha256, maskComments
//   Reporting              formatProblem, formatSkip, createReporter({ name, json }) (problem, skip,
//                          note, notApplicable, finish), run(main)
//   PNG                    parseColor, renderPng, encodePng, writePng(path, spec), decodePng(buffer),
//                          readPng(path), pngSize(bufferOrPath)
//   Fixture overlays       SUITE_FILE, CASES_FILE, MUTATION_FILE, DELETE_FILE, PLANT_FILE, CASE_LOCAL_FILES,
//                          FIXTURE_CONTROL_FILES, HYGIENE_RENAMES, OVERLAY_OPS, OVERLAY_DIR, SUITE_BASE_DIR, OverlayError,
//                          applyMutation(dir, ops, label, options), readSuiteSpec(dir, overrides),
//                          assembleSuiteCases(options), assembleSuite(options), assembleFixtures(dir, build)
//   Self-test              SELFTEST_CASES, selftestCaseKind(name), runSelftest(url, suites, options)
//                          (assembles overlay suites itself; --materialize <dir>, --case <glob>)
//   Pinned packages        toolingEnvVar(skill), resolveToolingDir, packageInstallFix, importPackage
//   Temporary folders      makeTempDir(prefix), removeTempDir(dir)
//
// Output contract (the same for every script):
//   SKIP <file> [<rule>] <message>                       a rule whose target is not yet created (notYetCreated)
//   FAIL <file>:<line> [<rule>] <message> Fix: <fix>     one line per problem
//   <name>: <n> <unit> checked, <m> problems             the summary
//   NOT APPLICABLE: <reason>                             instead of the summary, when a repo fact proves the
//                                                        whole check does not apply (exit 0)
//   ERROR [bad-input] <message> Fix: <fix>               bad input or environment (exit 2)
//   RESULT: PASS | RESULT: FAIL (<m> problems)            always the last line
// Exit 0 pass (SKIP lines and NOT APPLICABLE included), 1 problems found, 2 bad input or environment
// (nothing to check is exit 2, never a silent pass).

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import { crc32 as zlibCrc32, deflateSync, inflateSync } from 'node:zlib';

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, BAD_INPUT: 2 });

/** The exact last line every script prints. */
export const RESULT_PATTERN = /^RESULT: (PASS|FAIL \((\d+) problems\))$/;

export function resultLine(problemCount) {
  return problemCount === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${problemCount} problems)`;
}

/** Thrown for bad input or a broken environment; run() turns it into exit code 2. */
export class UsageError extends Error {
  constructor(message, fix = 'Run the script with --help to see its usage.') {
    super(message);
    this.name = 'UsageError';
    this.fix = fix;
  }
}

/** Stop with exit code 2 (bad input or environment). */
export function fail(message, fix) {
  throw new UsageError(message, fix);
}

export function toPosix(path) {
  return path.split(sep).join('/');
}

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

/**
 * Parse process arguments.
 * spec = {
 *   name: 'check-names',                        // script name used in the usage line
 *   summary: 'Checks that ...',                 // one or two sentences for --help
 *   usage: '[repo-root] [options]',             // shown after "node <name>.mjs"
 *   options: { json: { type: 'boolean', help: 'Also print the problems as JSON' },
 *              only: { type: 'string', multiple: true, value: 'rule', help: 'Repeatable' } },
 *   positionals: { min: 0, max: 1 },            // how many positional arguments are allowed
 *   details: 'More help text (rules, examples).'
 * }
 * Returns { options, positionals }. --help / -h prints the help and exits 0. A script that declares
 * a --root option and no positional arguments of its own also accepts the root positionally.
 */
export function parseArgs(argv, spec) {
  const optionSpec = { help: { type: 'boolean', short: 'h' } };
  for (const [key, value] of Object.entries(spec.options ?? {})) {
    optionSpec[key] = { type: value.type ?? 'string' };
    if (value.short) optionSpec[key].short = value.short;
    if (value.multiple) optionSpec[key].multiple = true;
  }
  let parsed;
  try {
    parsed = nodeParseArgs({ args: argv, options: optionSpec, allowPositionals: true, strict: true });
  } catch (error) {
    // Node appends a hint about "--" to unknown options; the usage fix below says more.
    const message = error.message.split('\n')[0].replace(/\. To specify a positional argument starting with a '-'.*$/, '');
    throw new UsageError(message, usageFix(spec, error.message));
  }
  if (parsed.values.help) {
    writeOut(`${helpText(spec)}\n`);
    process.exit(EXIT.PASS);
  }
  const options = {};
  for (const [key, value] of Object.entries(spec.options ?? {})) {
    const given = parsed.values[key];
    if (given !== undefined) options[key] = given;
    else if (value.default !== undefined) options[key] = value.default;
    else if (value.type === 'boolean') options[key] = false;
    else if (value.multiple) options[key] = [];
  }
  const { min = 0, max = Infinity } = positionalLimits(spec);
  let positionals = parsed.positionals;
  // Every checker takes the repo root as an optional positional argument. A script that declares a
  // --root option and no positional arguments of its own accepts the root positionally as well, so
  // `node <checker>.mjs . [options]` works for every checker.
  if (spec.options?.root && max === 0 && positionals.length === 1) {
    if (parsed.values.root !== undefined) {
      throw new UsageError(`the repo root was given twice: --root ${[parsed.values.root].flat().join(' ')} and ${positionals[0]}`, `Give it once, as the first argument: node ${spec.name}.mjs <repo-root> [options]`);
    }
    options.root = spec.options.root.multiple ? [positionals[0]] : positionals[0];
    positionals = [];
  }
  if (positionals.length < min) {
    throw new UsageError(`expected at least ${min} argument(s), got ${positionals.length}`, `Run: node ${spec.name}.mjs --help`);
  }
  if (positionals.length > max) {
    throw new UsageError(`expected at most ${max} argument(s), got ${positionals.length}: ${positionals.join(' ')}`, `Run: node ${spec.name}.mjs --help`);
  }
  return { options, positionals };
}

/** How many positional arguments a script takes: { min, max } (none when the spec says nothing). */
function positionalLimits(spec) {
  const { min = 0, max = Infinity } = spec.positionals ?? { min: 0, max: 0 };
  return { min, max };
}

/**
 * The fix text for an argument error. Checkers take the repo root as an optional positional
 * argument, so a guessed "--root <dir>" is answered with the positional form.
 */
function usageFix(spec, message) {
  const { max } = positionalLimits(spec);
  if (/Unknown option '--root'/.test(message) && !spec.options?.root && max >= 1) {
    return `This script takes the repo root as a positional argument, not --root: node ${spec.name}.mjs <repo-root> [options] (for example: node ${spec.name}.mjs .). Run: node ${spec.name}.mjs --help`;
  }
  return `Run: node ${spec.name}.mjs --help`;
}

/** Synchronous stdout write, so nothing is lost when the process exits right after. */
function writeOut(text) {
  try {
    writeSync(1, text);
  } catch {
    process.stdout.write(text);
  }
}

export function helpText(spec) {
  const lines = [`Usage: node ${spec.name}.mjs ${spec.usage ?? '[options]'}`.trimEnd(), ''];
  if (spec.summary) lines.push(spec.summary, '');
  const rows = [];
  for (const [key, value] of Object.entries(spec.options ?? {})) {
    const flag = `${value.short ? `-${value.short}, ` : ''}--${key}${value.type === 'boolean' ? '' : ` <${value.value ?? 'value'}>`}`;
    const def = value.default !== undefined && value.type !== 'boolean' ? ` (default: ${value.default})` : '';
    const positional = key === 'root' && positionalLimits(spec).max === 0 ? '; may also be given as the first argument' : '';
    rows.push([flag, `${value.help ?? ''}${value.multiple ? ' (repeatable)' : ''}${def}${positional}`]);
  }
  rows.push(['-h, --help', 'Show this help and exit']);
  const width = Math.max(...rows.map(([flag]) => flag.length));
  lines.push('Options:');
  for (const [flag, text] of rows) lines.push(`  ${flag.padEnd(width)}  ${text}`);
  if (spec.details) lines.push('', spec.details.trimEnd());
  lines.push(
    '',
    'Exit codes: 0 pass, 1 problems found, 2 bad input or environment.',
    'The last line is always "RESULT: PASS" or "RESULT: FAIL (<n> problems)".',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Globs and the file walker
// ---------------------------------------------------------------------------------------------

/** Convert a glob to a RegExp. Supports **, *, ?, {a,b} and [abc]. */
export function globToRegExp(glob) {
  let out = '';
  let i = 0;
  let braceDepth = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        const next = glob[i + 2];
        if (atStart && next === '/') {
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        if (atStart && next === undefined) {
          out += '.*';
          i += 2;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      braceDepth += 1;
      out += '(?:';
    } else if (ch === '}' && braceDepth > 0) {
      braceDepth -= 1;
      out += ')';
    } else if (ch === ',' && braceDepth > 0) {
      out += '|';
    } else if (ch === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let body = glob.slice(i + 1, close).replace(/\\/g, '\\\\');
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        out += `[${body}]`;
        i = close;
      }
    } else if ('\\^$.|+()'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  // "dir/**" also matches "dir" itself.
  out = out.replace(/\/\.\*$/, '(?:/.*)?');
  return new RegExp(`^${out}$`);
}

const globCache = new Map();
function cachedGlob(glob) {
  let re = globCache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re;
}

/**
 * Does a relative posix path match a glob? A glob without "/" is matched against every
 * path segment (gitignore style: "node_modules" or "*.png" match at any depth). A glob with "/"
 * is anchored at the walk root ("ios/**" skips <root>/ios, never src/ios).
 */
export function matchGlob(relPath, glob) {
  const clean = glob.replace(/^\.\//, '');
  if (!clean.includes('/')) {
    const re = cachedGlob(clean);
    return relPath.split('/').some((segment) => re.test(segment));
  }
  return cachedGlob(clean.replace(/\/$/, '/**')).test(relPath);
}

export const DEFAULT_IGNORES = Object.freeze(['node_modules', '.git', '.DS_Store', 'EXPECT.txt']);

/**
 * The folders agents install skills into, at the repo root. Installed skills carry templates and
 * fixtures with planted bugs on purpose, so no repo scan may read them. walkRepo() also prunes any
 * other folder that holds a SKILL.md.
 */
export const AGENT_SKILL_FOLDERS = Object.freeze(['skills', '.claude', '.agents', '.cursor', '.codex', '.windsurf', '.roo', '.cline', '.continue', '.kiro']);

/** Generated or build output of one app (at the repo root, or at the root of each workspace). */
const APP_OUTPUT_FOLDERS = Object.freeze(['ios', 'android', 'build', 'out', 'dist', 'web-build', 'coverage']);

/**
 * What every checker that walks the app repo skips, relative to the repo root: the agent skill
 * folders, the pinned tooling installs (.skill-tooling/), node_modules, CocoaPods, Expo and Turbo
 * caches and .git at any depth, and the root app's generated native projects (Continuous Native
 * Generation) and build output. Source folders that merely share a name, such as scripts/build/ or
 * src/ios/, are still scanned. A monorepo's workspaces add their own output folders: use
 * repoScanIgnores(root) or walkRepo(root), which read package.json "workspaces".
 */
export const REPO_SCAN_IGNORES = Object.freeze([
  ...AGENT_SKILL_FOLDERS.map((name) => `${name}/**`),
  '.skill-tooling/**',
  'node_modules',
  'Pods',
  '.expo',
  '.turbo',
  '.git',
  ...APP_OUTPUT_FOLDERS.map((name) => `${name}/**`),
]);

/**
 * REPO_SCAN_IGNORES plus the output folders of every workspace that package.json "workspaces"
 * declares (<workspace>/ios/**, <workspace>/build/**, ...) and each Node backend's build folder
 * (functions/lib/**, see backendWorkspaces). A single-app repo gets REPO_SCAN_IGNORES.
 */
export function repoScanIgnores(root = '.') {
  const extra = [];
  for (const workspace of readWorkspaces(root)) for (const name of APP_OUTPUT_FOLDERS) extra.push(`${workspace.dir}/${name}/**`);
  for (const backend of backendWorkspaces(root)) if (backend.buildDir !== null) extra.push(`${backend.buildDir}/**`);
  return Object.freeze([...REPO_SCAN_IGNORES, ...extra]);
}

const APP_CONFIG_FILES = Object.freeze(['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json']);

/**
 * The folder a package.json "main" builds into: its first segment when "main" is built JavaScript
 * (.js, .mjs, .cjs) one folder down or deeper, outside src/ ("lib/index.js" -> "lib"); else null.
 */
function buildFolderOf(manifest) {
  if (typeof manifest?.main !== 'string') return null;
  const parts = toPosix(manifest.main).replace(/^\.\//, '').split('/');
  if (parts.length < 2 || !/\.[cm]?js$/.test(parts.at(-1)) || ['', '.', '..', 'src'].includes(parts[0])) return null;
  return parts[0];
}

/**
 * The Node backend workspaces (Cloud Functions in functions/): every workspace outside packages/
 * that is no Expo app (no app config, no expo dependency), as architecture-and-boundaries reads
 * them. [{ dir, name, manifest, buildDir }], where buildDir is the repo-relative folder its
 * package.json "main" builds into ("functions/lib" for "main": "lib/index.js": the deploy bundle,
 * build output every scan and ignore list leaves out), or null. [] for a single-app repo.
 */
export function backendWorkspaces(root = '.') {
  const absRoot = resolve(root);
  return readWorkspaces(root)
    .filter((ws) => !ws.dir.startsWith('packages/') && !APP_CONFIG_FILES.some((name) => existsSync(join(absRoot, ws.dir, name))) && !(ws.manifest?.dependencies?.expo ?? ws.manifest?.devDependencies?.expo))
    .map((ws) => {
      const folder = buildFolderOf(ws.manifest);
      return { ...ws, buildDir: folder === null ? null : `${ws.dir}/${folder}` };
    });
}

/**
 * True when a repo-relative posix path lies under a repo-scan ignore (for paths that come from git:
 * diffs, logs). With `root`, the workspace output folders count too, and so does any folder below
 * the root that holds a SKILL.md.
 */
export function isRepoScanIgnored(relPath, root = null) {
  const clean = toPosix(relPath).replace(/^\.\//, '');
  const patterns = root === null ? REPO_SCAN_IGNORES : repoScanIgnores(root);
  if (patterns.some((glob) => matchGlob(clean, glob))) return true;
  if (root === null) return false;
  const segments = clean.split('/');
  for (let i = 1; i < segments.length; i += 1) if (existsSync(join(resolve(root), ...segments.slice(0, i), 'SKILL.md'))) return true;
  return false;
}

/**
 * List files under root as sorted relative posix paths.
 * options.ignore: globs to skip (added to DEFAULT_IGNORES unless defaultIgnores is false)
 * options.include: globs a file must match (default: every file)
 * options.pruneDirsContaining: file names; a folder below the root that holds one of them is skipped
 *   whole (walkRepo passes ['SKILL.md']: an installed skill is never scanned, wherever it lives)
 * options.onPrune(relDir): called for every pruned folder
 * options.followSymlinks: follow symlinked files and folders (default false: symlinks are skipped)
 * options.onSymlink(relPath): called for every skipped symlink
 */
export function walk(root, options = {}) {
  const ignore = [...(options.defaultIgnores === false ? [] : DEFAULT_IGNORES), ...(options.ignore ?? [])];
  const include = options.include ?? null;
  const prune = options.pruneDirsContaining ?? [];
  const files = [];
  const absRoot = resolve(root);
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) {
    throw new UsageError(`nothing to check: ${root} does not exist or is not a folder`, 'Pass the path of an existing folder.');
  }
  const visit = (absDir, isRoot) => {
    const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (!isRoot && prune.length > 0 && entries.some((entry) => prune.includes(entry.name) && !entry.isDirectory())) {
      options.onPrune?.(toPosix(relative(absRoot, absDir)));
      return;
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name);
      const rel = toPosix(relative(absRoot, abs));
      if (ignore.some((glob) => matchGlob(rel, glob))) continue;
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        if (!options.followSymlinks) {
          options.onSymlink?.(rel);
          continue;
        }
        const target = statSync(abs, { throwIfNoEntry: false });
        if (!target) continue;
        isDir = target.isDirectory();
        isFile = target.isFile();
      }
      if (isDir) visit(abs, false);
      else if (isFile && (!include || include.some((glob) => matchGlob(rel, glob)))) files.push(rel);
    }
  };
  visit(absRoot, true);
  return files;
}

/**
 * The walk every repo scan uses: repoScanIgnores(root) (agent skill folders, generated and build
 * output, workspace output folders) plus options.ignore, and every folder that holds a SKILL.md
 * pruned. Takes the same options as walk().
 *   const files = walkRepo(root, { include: ['*.ts', '*.tsx'] });
 */
export function walkRepo(root, options = {}) {
  return walk(root, {
    ...options,
    ignore: [...repoScanIgnores(root), ...(options.ignore ?? [])],
    pruneDirsContaining: options.pruneDirsContaining ?? ['SKILL.md'],
  });
}

export function requireDir(path, what = 'folder') {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new UsageError(`nothing to check: ${what} ${path} does not exist or is not a folder`, 'Pass the path of an existing folder.');
  }
  return resolve(path);
}

export function requireFile(path, what = 'file') {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new UsageError(`nothing to check: ${what} ${path} does not exist`, 'Pass the path of an existing file.');
  }
  return resolve(path);
}

// ---------------------------------------------------------------------------------------------
// Layout: where the app keeps things (defaults, tsconfig paths, workspaces, rn-skills.config.json)
// ---------------------------------------------------------------------------------------------

/** The optional repo file that overrides any layout key (and holds keys a skill documents). */
export const PROJECT_CONFIG_FILE = 'rn-skills.config.json';

/**
 * The canonical single-app layout. "{srcDir}" is replaced by the resolved srcDir, so moving the
 * source folder moves every folder inside it unless that folder is set on its own.
 */
export const LAYOUT_DEFAULTS = Object.freeze({
  srcDir: 'src',
  routesDir: '{srcDir}/app',
  featuresDir: '{srcDir}/features',
  uiDir: '{srcDir}/ui',
  themeDir: '{srcDir}/theme',
  coreDir: '{srcDir}/core',
  servicesDir: '{srcDir}/services',
  storesDir: '{srcDir}/stores',
  dataDir: '{srcDir}/data',
  apiDir: '{srcDir}/api',
  i18nDir: '{srcDir}/i18n',
  configDir: '{srcDir}/config',
  testDir: 'test',
  mocksDir: '__mocks__',
  scriptsDir: 'scripts',
  e2eDir: '.maestro',
  contractsDir: 'contracts',
});

export const LAYOUT_KEYS = Object.freeze(Object.keys(LAYOUT_DEFAULTS));

const CONFIG_FIX = `Write ${PROJECT_CONFIG_FILE} as one JSON object, for example { "srcDir": "app-src", "routesDir": "app" }: layout keys are repo-relative folders (no "..", no leading "/"), and "workspaces" maps a workspace folder to its own layout keys.`;

/**
 * Parse JSON with comments and trailing commas (tsconfig.json style). Strings are respected, so
 * "//" inside a string is kept. Throws SyntaxError on malformed input.
 */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  const source = String(text).replace(/^﻿/, '');
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  // Trailing commas before } or ] (outside strings: the strings were copied verbatim, so match
  // only commas followed by whitespace and a closer, skipping string bodies).
  let result = '';
  for (let k = 0; k < out.length; k += 1) {
    const ch = out[k];
    if (ch === '"') {
      let j = k + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      result += out.slice(k, j + 1);
      k = j;
      continue;
    }
    if (ch === ',') {
      let j = k + 1;
      while (j < out.length && /\s/.test(out[j])) j += 1;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    result += ch;
  }
  return JSON.parse(result);
}

function readJsonFile(path, what, fix) {
  let data;
  try {
    data = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON (${String(error.message).split('\n')[0]})`, fix);
  }
  return data;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkRepoRelative(value, where, fix) {
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('/') || isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new UsageError(`${where} must be a repo-relative folder (no "..", no leading "/"), got ${JSON.stringify(value)}`, fix);
  }
  return toPosix(value).replace(/^\.\//, '').replace(/\/+$/, '') || '.';
}

/**
 * The repo's rn-skills.config.json as a frozen object ({} when the file does not exist). Layout keys
 * must be repo-relative folders; "workspaces" must map folders to objects of layout keys; any other
 * key is kept for the skill that documents it. A malformed file stops the checker with exit 2.
 */
export function readProjectConfig(root = '.') {
  const path = join(resolve(root), PROJECT_CONFIG_FILE);
  if (!existsSync(path)) return Object.freeze({});
  const data = readJsonFile(path, PROJECT_CONFIG_FILE, CONFIG_FIX);
  if (!isPlainObject(data)) throw new UsageError(`${PROJECT_CONFIG_FILE} must hold one JSON object`, CONFIG_FIX);
  for (const key of LAYOUT_KEYS) if (key in data) checkRepoRelative(data[key], `${PROJECT_CONFIG_FILE} "${key}"`, CONFIG_FIX);
  if ('workspaces' in data) {
    if (!isPlainObject(data.workspaces)) throw new UsageError(`${PROJECT_CONFIG_FILE} "workspaces" must map a workspace folder to an object of layout keys`, CONFIG_FIX);
    for (const [dir, keys] of Object.entries(data.workspaces)) {
      checkRepoRelative(dir, `${PROJECT_CONFIG_FILE} "workspaces" key`, CONFIG_FIX);
      if (!isPlainObject(keys)) throw new UsageError(`${PROJECT_CONFIG_FILE} "workspaces"."${dir}" must be an object of layout keys`, CONFIG_FIX);
      for (const key of LAYOUT_KEYS) if (key in keys) checkRepoRelative(keys[key], `${PROJECT_CONFIG_FILE} "workspaces"."${dir}"."${key}"`, CONFIG_FIX);
    }
  }
  return Object.freeze(data);
}

/**
 * The path aliases of a tsconfig file (default tsconfig.json at the root), or null when it does not
 * exist. Comments and trailing commas are allowed; "extends" is followed one level for relative
 * files (a string or an array; package configs such as "expo/tsconfig.base" are not read). Like
 * TypeScript, "paths" targets resolve against "baseUrl" when one is set (relative to the file that
 * sets it), else against the folder of the file that holds "paths".
 * Returns { file, aliases: [{ pattern, targets }] } with repo-relative posix targets
 * ({ pattern: '@/*', targets: ['src/*'] }). A malformed file stops the checker with exit 2.
 */
export function readTsconfigPaths(root = '.', file = 'tsconfig.json') {
  const absRoot = resolve(root);
  const path = resolve(absRoot, file);
  if (!existsSync(path)) return null;
  const fix = 'Fix the JSON of the tsconfig file (comments and trailing commas are fine).';
  const read = (abs) => {
    const data = readJsonFile(abs, toPosix(relative(absRoot, abs)) || basename(abs), fix);
    return isPlainObject(data) ? data : {};
  };
  const config = read(path);
  // Effective settings: the child wins; baseUrl and paths remember the folder that declared them.
  let baseUrl = null;
  let paths = null;
  const take = (data, dir) => {
    const options = isPlainObject(data.compilerOptions) ? data.compilerOptions : {};
    if (typeof options.baseUrl === 'string') baseUrl = resolve(dir, options.baseUrl);
    if (isPlainObject(options.paths)) paths = { map: options.paths, dir };
  };
  const parents = [config.extends].flat().filter((value) => typeof value === 'string' && /^\.\.?\//.test(value));
  for (const parent of parents) {
    const candidates = [resolve(dirname(path), parent), resolve(dirname(path), `${parent}.json`)];
    const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (found) take(read(found), dirname(found));
  }
  take(config, dirname(path));
  const aliases = [];
  if (paths) {
    const against = baseUrl ?? paths.dir;
    for (const [pattern, targets] of Object.entries(paths.map)) {
      if (!Array.isArray(targets)) continue;
      const list = targets.filter((target) => typeof target === 'string').map((target) => toPosix(relative(absRoot, resolve(against, target))) || '.');
      aliases.push({ pattern, targets: list });
    }
  }
  return { file: toPosix(relative(absRoot, path)), aliases };
}

/**
 * The repo-relative candidate paths a specifier maps to through tsconfig aliases, or null when no
 * alias matches. The longest matching prefix wins, as in TypeScript; nothing is probed on disk.
 *   resolveAlias('@/ui/app-text', [{ pattern: '@/*', targets: ['src/*'] }])  ->  ['src/ui/app-text']
 */
export function resolveAlias(spec, aliases) {
  let best = null;
  for (const alias of aliases ?? []) {
    const star = alias.pattern.indexOf('*');
    if (star === -1) {
      if (spec === alias.pattern && (best === null || alias.pattern.length > best.prefixLength)) best = { prefixLength: alias.pattern.length, paths: alias.targets };
      continue;
    }
    const prefix = alias.pattern.slice(0, star);
    const suffix = alias.pattern.slice(star + 1);
    if (spec.length < prefix.length + suffix.length || !spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    if (best !== null && prefix.length <= best.prefixLength) continue;
    const middle = spec.slice(prefix.length, spec.length - suffix.length);
    best = { prefixLength: prefix.length, paths: alias.targets.map((target) => target.replace('*', middle)) };
  }
  return best === null ? null : best.paths;
}

/** Folders a workspace glob never descends into. */
const WORKSPACE_SKIP = new Set(['node_modules', '.git', 'ios', 'android', 'Pods', '.expo']);

/**
 * The workspace packages package.json "workspaces" declares (npm/yarn/pnpm-style globs, or yarn's
 * { packages: [...] }; "!pattern" excludes): [{ dir, name, manifest }] sorted by dir, only folders
 * that hold a package.json. [] for a single-app repo (no "workspaces"), which is the default layout.
 */
export function readWorkspaces(root = '.') {
  const absRoot = resolve(root);
  const manifestPath = join(absRoot, 'package.json');
  if (!existsSync(manifestPath)) return [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
  const declared = Array.isArray(manifest?.workspaces) ? manifest.workspaces : Array.isArray(manifest?.workspaces?.packages) ? manifest.workspaces.packages : [];
  const clean = (pattern) => toPosix(pattern).replace(/^\.\//, '').replace(/\/+$/, '');
  const patterns = declared.filter((value) => typeof value === 'string' && value.trim() !== '');
  const include = patterns.filter((value) => !value.startsWith('!')).map(clean);
  const exclude = patterns.filter((value) => value.startsWith('!')).map((value) => clean(value.slice(1)));
  const found = new Set();
  for (const pattern of include) {
    if (pattern.split('/').includes('..')) continue;
    if (!/[*?[{]/.test(pattern)) {
      if (existsSync(join(absRoot, pattern, 'package.json'))) found.add(pattern);
      continue;
    }
    const segments = pattern.split('/');
    const fixed = [];
    for (const segment of segments) {
      if (/[*?[{]/.test(segment)) break;
      fixed.push(segment);
    }
    const maxDepth = pattern.includes('**') ? 6 : segments.length - fixed.length;
    const re = globToRegExp(pattern);
    const visit = (rel, depth) => {
      const abs = join(absRoot, rel);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
      if (rel !== '' && re.test(rel) && existsSync(join(abs, 'package.json'))) found.add(rel);
      if (depth >= maxDepth) return;
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || WORKSPACE_SKIP.has(entry.name)) continue;
        visit(rel === '' ? entry.name : `${rel}/${entry.name}`, depth + 1);
      }
    };
    visit(fixed.join('/'), 0);
  }
  const out = [];
  for (const dir of [...found].sort()) {
    if (dir === '' || exclude.some((pattern) => globToRegExp(pattern).test(dir))) continue;
    let pkg = null;
    try {
      pkg = JSON.parse(readFileSync(join(absRoot, dir, 'package.json'), 'utf8'));
    } catch {
      pkg = null;
    }
    out.push({ dir, name: typeof pkg?.name === 'string' ? pkg.name : '', manifest: pkg });
  }
  return out;
}

/** One app's folders: defaults < config keys < overrides, {srcDir} filled, prefixed with the app folder. */
function layoutFor(absRoot, prefix, config, overrides) {
  const origin = {};
  const raw = {};
  for (const key of LAYOUT_KEYS) {
    if (overrides[key] !== undefined && overrides[key] !== null) {
      raw[key] = checkRepoRelative(overrides[key], `the ${key} option`, 'Pass a repo-relative folder.');
      origin[key] = 'override';
    } else if (config[key] !== undefined) {
      raw[key] = checkRepoRelative(config[key], `${PROJECT_CONFIG_FILE} "${key}"`, CONFIG_FIX);
      origin[key] = 'config';
    } else {
      raw[key] = LAYOUT_DEFAULTS[key];
      origin[key] = 'default';
    }
  }
  const join2 = (a, b) => (a === '' || a === '.' ? b : b === '.' ? a : `${a}/${b}`);
  const dirs = {};
  for (const key of LAYOUT_KEYS) {
    const value = key === 'srcDir' ? raw.srcDir : raw[key].replaceAll('{srcDir}', raw.srcDir);
    dirs[key] = posix.normalize(join2(prefix, value));
  }
  // Expo Router also accepts app/ at the app root: use it when the default src/app does not exist.
  if (origin.routesDir === 'default' && !existsSync(join(absRoot, dirs.routesDir)) && existsSync(join(absRoot, join2(prefix, 'app')))) {
    dirs.routesDir = join2(prefix, 'app');
    origin.routesDir = 'detected';
  }
  const tsconfig = readTsconfigPaths(absRoot, join2(prefix, 'tsconfig.json'));
  return { ...dirs, aliases: tsconfig?.aliases ?? [], tsconfig: tsconfig?.file ?? null, origin };
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Where this app keeps things, as repo-relative posix folders: the canonical defaults
 * (LAYOUT_DEFAULTS), then rn-skills.config.json, then `overrides` (a checker's own options, for
 * example { routesDir: options['routes-dir'] }; undefined values are ignored). Also reads the
 * tsconfig.json path aliases and package.json workspaces. Returns a frozen object:
 *   { root, mode: 'single' | 'monorepo', srcDir, routesDir, ..., contractsDir,
 *     aliases: [{ pattern, targets }], tsconfig: 'tsconfig.json' | null,
 *     origin: { <key>: 'default' | 'config' | 'override' | 'detected' },
 *     workspaces: [{ dir, name, layout }], config }
 * In monorepo mode each workspace has its own layout (its folders prefixed with its dir, its own
 * tsconfig aliases, and the keys of config.workspaces[dir]). A malformed config stops with exit 2.
 */
export function resolveLayout(root = '.', overrides = {}) {
  const absRoot = resolve(root);
  const config = readProjectConfig(absRoot);
  const workspaces = readWorkspaces(absRoot).map((workspace) => ({
    dir: workspace.dir,
    name: workspace.name,
    layout: layoutFor(absRoot, workspace.dir, config.workspaces?.[workspace.dir] ?? {}, {}),
  }));
  return deepFreeze({ root: absRoot, mode: workspaces.length > 0 ? 'monorepo' : 'single', ...layoutFor(absRoot, '', config, overrides ?? {}), workspaces, config });
}

// ---------------------------------------------------------------------------------------------
// Incremental adoption: a rule whose target is not yet created
// ---------------------------------------------------------------------------------------------

/**
 * Why a rule is skipped in an app that adopts the skills step by step, or null when it must be
 * checked. While `file` does not exist it returns 'not yet created (<owner> creates it)', where
 * owner names the skill or step that creates it; once the file exists the rule is strict.
 *   const reason = notYetCreated(root, { file: 'src/i18n/catalogs/en.json', owner: 'i18n-strings-and-catalogs' });
 *   if (reason) report.skip({ file: 'src/i18n/catalogs/en.json', rule: 'catalog-key', message: reason });
 * prints: SKIP src/i18n/catalogs/en.json [catalog-key] not yet created (i18n-strings-and-catalogs creates it)
 * Never in a ship gate (release, store artifact, completeness): there a missing file is a problem.
 */
export function notYetCreated(root, { file, owner } = {}) {
  if (typeof file !== 'string' || file.trim() === '' || file.startsWith('/') || isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
    throw new Error(`notYetCreated: file must be a repo-relative path, got ${JSON.stringify(file)}`);
  }
  if (typeof owner !== 'string' || owner.trim() === '') throw new Error(`notYetCreated: owner must name the skill or step that creates ${file}`);
  const rel = toPosix(file).replace(/^\.\//, '');
  return existsSync(join(resolve(root), rel)) ? null : `not yet created (${owner.trim()} creates it)`;
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

export function isBinary(buffer) {
  const limit = Math.min(buffer.length, 8000);
  for (let i = 0; i < limit; i += 1) if (buffer[i] === 0) return true;
  return false;
}

/** Read a UTF-8 text file; returns null for binary files. */
export function readText(path) {
  const buffer = readFileSync(path);
  return isBinary(buffer) ? null : buffer.toString('utf8');
}

/** 1-based line number of a character index. */
export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function sha256(bufferOrString) {
  return createHash('sha256').update(bufferOrString).digest('hex');
}

/**
 * Replace JS/TS comments with spaces (newlines kept) so grep-style checks skip comments and
 * report correct line numbers. Strings and template literals are kept; regex literals are
 * recognised after operators and keywords.
 */
export function maskComments(source) {
  let out = '';
  let i = 0;
  let lastSignificant = '';
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  const regexAllowedAfter = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === '\\') j += 1;
        else if (ch !== '`' && source[j] === '\n') break;
        j += 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      lastSignificant = ch;
      continue;
    }
    if (ch === '/' && regexAllowedAfter.has(lastSignificant)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j += 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      lastSignificant = '/';
      continue;
    }
    out += ch;
    if (!/\s/.test(ch)) {
      lastSignificant = /[A-Za-z0-9_$)\]]/.test(ch) ? 'x' : ch;
      if (/[A-Za-z]/.test(ch) && (i === 0 || !/[A-Za-z0-9_$]/.test(source[i - 1]))) {
        const word = /^[A-Za-z]+/.exec(source.slice(i))[0];
        if (['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await'].includes(word)) {
          out += word.slice(1);
          i += word.length;
          lastSignificant = '(';
          continue;
        }
      }
    }
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Problems, summary and exit codes
// ---------------------------------------------------------------------------------------------

export function formatProblem({ file, line, rule, message, fix }) {
  const where = file ? `${file}${line ? `:${line}` : ''} ` : '';
  return `FAIL ${where}[${rule}] ${message}${fix ? ` Fix: ${fix}` : ''}`;
}

export function formatSkip({ file, rule, message }) {
  return `SKIP ${file ? `${file} ` : ''}[${rule}] ${message}`;
}

/**
 * Collects problems and prints the standard summary.
 *   const report = createReporter({ name: 'check-names', json: options.json });
 *   report.problem({ file, line, rule, message, fix });
 *   report.skip({ file, rule, message });        // a rule whose target is not yet created: printed, not counted
 *   report.note('text');                         // an informational line
 *   return report.finish({ checked: files.length, unit: 'files' });   // returns the exit code
 *   return report.notApplicable('react-native-google-mobile-ads is not in package.json');  // exit 0, RESULT: PASS
 *
 * SKIP is for one rule whose target an app adopting the skills step by step has not created yet
 * (notYetCreated). NOT APPLICABLE is for the whole check, and only when a repo fact proves it. A
 * target that is simply missing is still bad input (exit 2), or a problem (exit 1) once it should
 * exist. finish() with nothing checked, no problem and no skip is exit 2 (nothing to check).
 */
export function createReporter({ name, json = false } = {}) {
  const problems = [];
  const skips = [];
  const sortByFile = (list) => [...list].sort((a, b) => (a.file === b.file ? (a.line ?? 0) - (b.line ?? 0) : a.file < b.file ? -1 : 1));
  const printSkips = () => {
    const sorted = sortByFile(skips);
    for (const entry of sorted) console.log(formatSkip(entry));
    return sorted;
  };
  return {
    problems,
    skips,
    get count() {
      return problems.length;
    },
    problem(entry) {
      if (!entry.rule || !entry.message) throw new Error('report.problem() needs at least rule and message');
      problems.push({ file: entry.file ?? '', line: entry.line ?? 0, rule: entry.rule, message: entry.message, fix: entry.fix ?? '' });
    },
    skip(entry) {
      if (!entry.rule || !entry.message) throw new Error('report.skip() needs at least rule and message');
      skips.push({ file: entry.file ?? '', rule: entry.rule, message: entry.message });
    },
    note(text) {
      console.log(text);
    },
    notApplicable(reason) {
      if (typeof reason !== 'string' || reason.trim() === '') throw new Error('report.notApplicable() needs the repo fact that proves it');
      if (problems.length > 0) throw new Error('report.notApplicable() after problems were reported: finish() instead');
      const sortedSkips = printSkips();
      console.log(`NOT APPLICABLE: ${reason.trim()}`);
      if (json) console.log(JSON.stringify({ name, checked: 0, notApplicable: reason.trim(), skips: sortedSkips, problems: [] }));
      console.log(resultLine(0));
      process.exitCode = EXIT.PASS;
      return EXIT.PASS;
    },
    finish({ checked, unit = 'files' } = {}) {
      if (checked === 0 && problems.length === 0 && skips.length === 0) {
        throw new UsageError(`nothing to check: 0 ${unit} found`, 'Point the script at a folder that contains the files it checks.');
      }
      const sortedSkips = printSkips();
      const sorted = sortByFile(problems);
      for (const entry of sorted) console.log(formatProblem(entry));
      const countText = checked === undefined ? '' : `${checked} ${unit} checked, `;
      const skipText = skips.length > 0 ? `, ${skips.length} skipped` : '';
      console.log(`${name}: ${countText}${problems.length} problems${skipText}`);
      if (json) console.log(JSON.stringify({ name, checked: checked ?? null, problems: sorted, ...(skips.length > 0 ? { skips: sortedSkips } : {}) }));
      console.log(resultLine(problems.length));
      const code = problems.length === 0 ? EXIT.PASS : EXIT.FAIL;
      process.exitCode = code;
      return code;
    },
  };
}

/**
 * Run a script's main function with the standard exit codes.
 *   run(async () => { ...; return report.finish({ checked }); });
 * UsageError -> exit 2 with an ERROR line; any other exception -> exit 2 with the stack.
 */
export async function run(main) {
  try {
    const code = await main();
    if (typeof code === 'number') process.exitCode = code;
  } catch (error) {
    if (error instanceof UsageError) {
      console.log(`ERROR [bad-input] ${error.message} Fix: ${error.fix}`);
    } else {
      console.log(`ERROR [crash] ${error?.stack ?? error} Fix: this is a bug in the script; fix it, then rerun.`);
    }
    console.log(resultLine(1));
    process.exitCode = EXIT.BAD_INPUT;
  }
}

// ---------------------------------------------------------------------------------------------
// PNG: generate fixture images and read simple ones without a package
// ---------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let crcTable = null;

/** CRC-32 of a buffer: zlib.crc32 (Node 22.2+), else a table. */
function crc32(buffer) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buffer) >>> 0;
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * An RGBA color from '#rgb', '#rgba', '#rrggbb', '#rrggbbaa' or [r, g, b] / [r, g, b, a] (0-255).
 * Alpha defaults to 255.
 */
export function parseColor(value) {
  if (Array.isArray(value) && (value.length === 3 || value.length === 4) && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return [value[0], value[1], value[2], value[3] ?? 255];
  }
  if (typeof value === 'string') {
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())?.[1];
    if (hex) {
      const full = hex.length <= 4 ? [...hex].map((ch) => ch + ch).join('') : hex;
      const bytes = full.match(/../g).map((pair) => Number.parseInt(pair, 16));
      return [bytes[0], bytes[1], bytes[2], bytes[3] ?? 255];
    }
  }
  throw new Error(`not a color: ${JSON.stringify(value)} (use "#rrggbb", "#rrggbbaa" or [r, g, b, a])`);
}

/**
 * Raw RGBA pixels from a spec: { width, height, fill = transparent, rects: [{ x, y, width, height,
 * fill }] (w/h and color are accepted too; clipped to the image), paint(x, y) -> color (optional,
 * per pixel, after rects), data (raw RGBA bytes instead of all of the above) }.
 */
export function renderPng({ width, height, fill = [0, 0, 0, 0], rects = [], paint = null, data = null } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384) {
    throw new Error(`a PNG needs integer width and height between 1 and 16384, got ${width}x${height}`);
  }
  if (data !== null) {
    if (data.length !== width * height * 4) throw new Error(`data has ${data.length} bytes, expected ${width * height * 4} (RGBA)`);
    return { width, height, data: Uint8Array.from(data) };
  }
  const pixels = new Uint8Array(width * height * 4);
  const background = parseColor(fill);
  for (let i = 0; i < width * height; i += 1) pixels.set(background, i * 4);
  for (const rect of rects) {
    const color = parseColor(rect.fill ?? rect.color ?? [0, 0, 0, 255]);
    const x0 = Math.max(0, Math.floor(rect.x ?? 0));
    const y0 = Math.max(0, Math.floor(rect.y ?? 0));
    const x1 = Math.min(width, x0 + Math.floor(rect.width ?? rect.w ?? 0));
    const y1 = Math.min(height, y0 + Math.floor(rect.height ?? rect.h ?? 0));
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) pixels.set(color, (y * width + x) * 4);
  }
  if (typeof paint === 'function') {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const color = paint(x, y);
      if (color !== undefined && color !== null) pixels.set(parseColor(color), (y * width + x) * 4);
    }
  }
  return { width, height, data: pixels };
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode raw RGBA pixels ({ width, height, data }) as an 8-bit RGBA PNG buffer (filter 0, no interlace). */
export function encodePng({ width, height, data }) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(data.buffer, data.byteOffset + y * rowBytes, rowBytes).copy(raw, y * (rowBytes + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/**
 * Write a generated PNG (see renderPng for the spec) and return its path; parent folders are made.
 *   writePng(join(dir, 'home.png'), { width: 120, height: 260, fill: '#ffffff', rects: [{ x: 10, y: 10, width: 100, height: 40, fill: '#3366ff' }] });
 */
export function writePng(path, spec) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(renderPng(spec)));
  return path;
}

/** { width, height, bitDepth, colorType, interlace } from a PNG's IHDR (a buffer or a path), without decoding pixels. */
export function pngSize(bufferOrPath) {
  const buffer = typeof bufferOrPath === 'string' ? readFileSync(bufferOrPath) : bufferOrPath;
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG file');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bitDepth: buffer[24], colorType: buffer[25], interlace: buffer[28] };
}

/**
 * Decode a non-interlaced PNG to 8-bit RGBA: { width, height, data } (data: Uint8Array, 4 bytes per
 * pixel, rows top to bottom). Supports grayscale, RGB, palette (with tRNS), gray+alpha and RGBA at
 * the bit depths PNG allows (16-bit samples keep their high byte). Throws on anything else
 * (interlaced images, a bad CRC, truncated data).
 */
export function decodePng(buffer) {
  const { width, height, bitDepth, colorType, interlace } = pngSize(buffer);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`unsupported PNG color type ${colorType} / bit depth ${bitDepth}`);
  let offset = 8;
  const idat = [];
  let palette = null;
  let transparency = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (offset + 12 + length > buffer.length) throw new Error(`truncated PNG chunk ${type}`);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== buffer.readUInt32BE(offset + 8 + length)) throw new Error(`bad CRC in PNG chunk ${type}`);
    if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (colorType === 3 && palette === null) throw new Error('palette PNG without a PLTE chunk');
  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new Error('truncated PNG image data');
  const lines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = lines.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= bpp ? up[x - bpp] : 0;
      let value = src[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter type ${filter}`);
      out[x] = value & 0xff;
    }
  }
  const sample = (row, index) => {
    if (bitDepth === 8) return lines[row * stride + index];
    if (bitDepth === 16) return lines[row * stride + index * 2];
    const bit = index * bitDepth;
    const byte = lines[row * stride + (bit >> 3)];
    return (byte >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
  };
  const scale = (value) => (bitDepth >= 8 ? value : Math.round((value * 255) / ((1 << bitDepth) - 1)));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (colorType === 3) {
        const index = sample(y, x);
        data[at] = palette[index * 3];
        data[at + 1] = palette[index * 3 + 1];
        data[at + 2] = palette[index * 3 + 2];
        data[at + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const gray = scale(sample(y, x * channels));
        data[at] = gray;
        data[at + 1] = gray;
        data[at + 2] = gray;
        data[at + 3] = colorType === 4 ? scale(sample(y, x * channels + 1)) : 255;
      } else {
        data[at] = scale(sample(y, x * channels));
        data[at + 1] = scale(sample(y, x * channels + 1));
        data[at + 2] = scale(sample(y, x * channels + 2));
        data[at + 3] = colorType === 6 ? scale(sample(y, x * channels + 3)) : 255;
      }
    }
  }
  return { width, height, data };
}

/** decodePng(readFileSync(path)). */
export function readPng(path) {
  return decodePng(readFileSync(path));
}

// ---------------------------------------------------------------------------------------------
// Fixture overlays: a case = a base tree + DELETE.txt + overlay files + mutation.json ops
// ---------------------------------------------------------------------------------------------

/** A suite folder that holds this file is assembled by runSelftest (see readSuiteSpec). */
export const SUITE_FILE = 'SUITE.json';
/**
 * A suite folder may hold every case's mutation in this one file instead of a mutation.json (and an
 * ARGS.txt) per case: { "<case>": [ops] | { "$comment", "base", "extends", "ops", "args", "expect" } }.
 * "args" is ARGS.txt's text. "expect" is EXPECT.txt's text (a string, or a list of lines): a case with
 * "expect" needs no case folder at all; a key without it names a case folder that holds its EXPECT.txt.
 */
export const CASES_FILE = 'CASES.json';
export const MUTATION_FILE = 'mutation.json';
export const DELETE_FILE = 'DELETE.txt';
/** Legacy: { "<path>": "<text>" | true } files to create at run time (true: a defused private key note). */
export const PLANT_FILE = 'plant.json';
/** Files that belong to one case only: copied into that case's tree, never inherited through a base. */
export const CASE_LOCAL_FILES = Object.freeze(['EXPECT.txt', 'ARGS.txt']);
/** Files at a case root that drive assembly and are never copied. */
export const FIXTURE_CONTROL_FILES = Object.freeze([MUTATION_FILE, DELETE_FILE, PLANT_FILE]);
/**
 * Names no skill may commit (a nested .gitignore acts as a real ignore rule; installers drop
 * metadata.json): fixtures store them under these names and assembly renames them back.
 */
export const HYGIENE_RENAMES = Object.freeze({ 'dot-gitignore': '.gitignore', 'dot-metadata.json': 'metadata.json' });
export const OVERLAY_OPS = Object.freeze(['replace', 'json', 'write', 'delete', 'rename', 'copy', 'png', 'reformat', 'mkdir', 'symlink', 'plant']);
/** A case's (or a base folder's) overlay files may sit in this folder: its contents land at the tree root. */
export const OVERLAY_DIR = 'overlay';
/** A suite folder that holds this folder (and no SUITE.json) is an overlay suite with it as the base. */
export const SUITE_BASE_DIR = 'base';

/** Root entries of a case or base folder that are never copied as tree files. */
const isRootControl = (name) => CASE_LOCAL_FILES.includes(name) || FIXTURE_CONTROL_FILES.includes(name) || name === SUITE_FILE || name === OVERLAY_DIR;

const SUITE_KEYS = new Set(['$comment', 'base', 'extends', 'ops', 'argsFile', 'legacyOps', 'renames']);
const MUTATION_KEYS = ['$comment', 'base', 'extends', 'ops'];
const ARGS_FILE_MODES = ['replace', 'append', 'error-only'];
// Built from parts so this file never contains private key text itself.
const DEFUSED_KEY = ['-----BEGIN ', 'PRIVATE KEY-----', '\nnot-a-real-key\n', '-----END ', 'PRIVATE KEY-----', '\n'].join('');

/** A fixture that no longer matches its base (a stale op, a missing base): the case fails loudly. */
export class OverlayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OverlayError';
  }
}

/** A repo-relative path inside `dir`, or an OverlayError (absolute paths and ".." are refused). */
function insidePath(dir, rel, label, what) {
  if (typeof rel !== 'string' || rel.trim() === '' || rel.startsWith('/') || isAbsolute(rel) || toPosix(rel).split('/').includes('..')) {
    throw new OverlayError(`${label}: ${what} must be a path inside the case, got ${JSON.stringify(rel)}`);
  }
  return join(dir, rel);
}

function writeInside(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function occurrences(text, find, regex) {
  const found = [];
  if (regex) {
    for (const match of text.matchAll(new RegExp(find, 'g'))) {
      if (match[0] === '') throw new OverlayError(`the pattern ${JSON.stringify(find)} matches the empty string`);
      found.push({ index: match.index, text: match[0] });
    }
    return found;
  }
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) found.push({ index: at, text: find });
  return found;
}

function replaceOp(dir, op, label, legacyOps) {
  const { file, find, with: replacement, all, count, occurrence, regex } = op;
  const path = insidePath(dir, file, label, 'replace.file');
  if (typeof find !== 'string' || find === '') throw new OverlayError(`${label}: replace needs a non-empty "find" string`);
  if (typeof replacement !== 'string') throw new OverlayError(`${label}: replace needs a "with" string`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new OverlayError(`${label}: ${file} does not exist; update its ${MUTATION_FILE}`);
  const text = readFileSync(path, 'utf8');
  const found = occurrences(text, find, regex);
  if (found.length === 0) throw new OverlayError(`${label}: "${find}" not found in ${file}; update its ${MUTATION_FILE}`);
  let chosen;
  if (count !== undefined) {
    if (found.length !== count) throw new OverlayError(`${label}: "${find}" occurs ${found.length} times in ${file}, the op expects ${count}; update its ${MUTATION_FILE}`);
    chosen = found;
  } else if (occurrence !== undefined) {
    if (!Number.isInteger(occurrence) || occurrence < 1) throw new OverlayError(`${label}: replace "occurrence" must be 1 or more`);
    if (found.length < occurrence) throw new OverlayError(`${label}: "${find}" occurs ${found.length} times in ${file}, the op replaces occurrence ${occurrence}; update its ${MUTATION_FILE}`);
    chosen = [found[occurrence - 1]];
  } else if (all === true || legacyOps === 'all') {
    chosen = found;
  } else if (legacyOps === 'first') {
    chosen = [found[0]];
  } else {
    if (found.length !== 1) throw new OverlayError(`${label}: "${find}" occurs ${found.length} times in ${file}; make "find" unique, or add "all": true, "count": ${found.length} or "occurrence": <n>`);
    chosen = found;
  }
  let out = '';
  let last = 0;
  for (const match of chosen) {
    const value = regex ? match.text.replace(new RegExp(find), replacement) : replacement;
    out += text.slice(last, match.index) + value;
    last = match.index + match.text.length;
  }
  writeFileSync(path, out + text.slice(last));
}

function jsonPathText(path) {
  return path.map((key) => JSON.stringify(key)).join(' > ');
}

function jsonOp(dir, op, label, legacyOps) {
  const { file, value, literalNull = false, indent = 2 } = op;
  const path = Array.isArray(op.path) ? op.path : op.path === undefined ? null : [op.path];
  const abs = insidePath(dir, file, label, 'json.file');
  if (path === null || path.length === 0) throw new OverlayError(`${label}: json needs "path": a list of keys (["scripts", "test"])`);
  if (!existsSync(abs)) throw new OverlayError(`${label}: ${file} does not exist; update its ${MUTATION_FILE}`);
  let data;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new OverlayError(`${label}: ${file} is not valid JSON (${String(error.message).split('\n')[0]})`);
  }
  const remove = op.delete === true || (value === null && !literalNull);
  if (!remove && value === undefined && !literalNull) throw new OverlayError(`${label}: json needs "value" (or "delete": true) for ${jsonPathText(path)} in ${file}`);
  let node = data;
  for (const [i, key] of path.slice(0, -1).entries()) {
    if (node[key] === undefined || node[key] === null) {
      if (remove) {
        if (legacyOps) return;
        throw new OverlayError(`${label}: ${file} has no ${jsonPathText(path.slice(0, i + 1))}; update its ${MUTATION_FILE}`);
      }
      node[key] = {};
    }
    node = node[key];
    if (node === null || typeof node !== 'object') throw new OverlayError(`${label}: ${jsonPathText(path.slice(0, i + 1))} in ${file} is not an object or array`);
  }
  const last = path.at(-1);
  if (remove) {
    if (!(last in node)) {
      if (legacyOps) return;
      throw new OverlayError(`${label}: ${file} has no ${jsonPathText(path)}; update its ${MUTATION_FILE}`);
    }
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  } else {
    node[last] = literalNull ? null : value;
  }
  writeFileSync(abs, `${JSON.stringify(data, null, indent)}\n`);
}

function writeOp(dir, op, label) {
  const path = insidePath(dir, op.file, label, 'write.file');
  const given = ['content', 'json', 'lines', 'base64'].filter((key) => op[key] !== undefined);
  if (given.length !== 1) throw new OverlayError(`${label}: write needs exactly one of "content", "json", "lines" or "base64" for ${op.file}`);
  const [kind] = given;
  if (kind === 'content' && typeof op.content !== 'string') throw new OverlayError(`${label}: write "content" must be a string`);
  if (kind === 'lines' && !(Array.isArray(op.lines) && op.lines.every((line) => typeof line === 'string'))) throw new OverlayError(`${label}: write "lines" must be a list of strings`);
  const content = kind === 'content' ? op.content : kind === 'json' ? `${JSON.stringify(op.json, null, op.indent ?? 2)}\n` : kind === 'lines' ? `${op.lines.join('\n')}\n` : Buffer.from(op.base64, 'base64');
  writeInside(path, content);
}

function mustExist(dir, rel, label, what) {
  const path = insidePath(dir, rel, label, what);
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) throw new OverlayError(`${label}: ${rel} does not exist; update its ${MUTATION_FILE}`);
  return path;
}

function plantOp(dir, plant, label) {
  if (!isPlainObject(plant)) throw new OverlayError(`${label}: plant must map paths to text (or true for a defused private key note)`);
  for (const [rel, content] of Object.entries(plant)) {
    const path = insidePath(dir, rel, label, 'plant path');
    writeInside(path, typeof content === 'string' ? content : `# Handover\n\nkey:\n${DEFUSED_KEY}`);
  }
}

/**
 * Apply one case's ops in order; every op must apply, so a stale fixture fails loudly
 * (OverlayError). Ops (one key each, plus an optional "$comment"; the flat spelling
 * { "op": "replace", "file": ..., "find": ..., "with": ... } is accepted too, with path/paths for delete and mkdir):
 *   { replace: { file, find, with, all?, count?, occurrence?, regex? } }  find must occur exactly once,
 *       unless all: true (every occurrence), count: n (exactly n, all replaced) or occurrence: k (only
 *       the k-th); regex: true makes find a RegExp source and "with" may use $1
 *   { json: { file, path: [keys], value } }        set a value (missing objects are created)
 *   { json: { file, path, delete: true } }         delete a key or array item (it must exist);
 *       "value": null also deletes (the legacy form); "literalNull": true sets JSON null
 *   { write: { file, content | json | lines | base64 } }   create or overwrite a file
 *   { delete: 'path' | ['a', 'b'] }                remove files or folders (each must exist)
 *   { rename: { from, to, overwrite? } }           move a file or folder (to must not exist)
 *   { copy: { from, to } }                         copy a file or folder inside the case
 *   { png: { file | files, width, height, fill?, rects? } }   write a generated PNG (writePng)
 *   { reformat: { file, indent? } }                rewrite a JSON file in JSON.stringify layout
 *   { mkdir: 'path' | ['a', 'b'] }                 make (empty) folders, which git cannot store
 *   { symlink: { path, target } }                  make a symlink, which a skill may not commit
 *   { plant: { '<path>': '<text>' | true } }       files made at run time (true: a defused private-key
 *       note, built from parts so no committed file holds key text)
 * options.legacyOps: 'all' or 'first' gives replace without all/count/occurrence the behaviour of the
 * older per-skill assemblers (every occurrence, or the first), and lets a json delete of a missing
 * key pass; leave it unset for new fixtures.
 */
export function applyMutation(dir, ops, label = MUTATION_FILE, { legacyOps = null } = {}) {
  if (!Array.isArray(ops)) throw new OverlayError(`${label}: ${MUTATION_FILE} must be a list of ops (or { "ops": [...] })`);
  for (const [index, entry] of ops.entries()) {
    const where = `${label} op ${index + 1}`;
    if (!isPlainObject(entry)) throw new OverlayError(`${where}: each op is an object with one key (${OVERLAY_OPS.join(', ')})`);
    // Two spellings: { replace: { file, find, with } } (the default) or { op: 'replace', file, find, with }.
    const flat = typeof entry.op === 'string';
    const keys = flat ? [entry.op] : Object.keys(entry).filter((key) => key !== '$comment');
    if (keys.length !== 1 || !OVERLAY_OPS.includes(keys[0])) throw new OverlayError(`${where}: unknown op ${JSON.stringify(entry)}; ops are ${OVERLAY_OPS.join(', ')}`);
    const [kind] = keys;
    const rest = flat ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'op' && key !== '$comment')) : null;
    // The flat spelling of the list-valued ops: { op: 'delete', path | paths }, { op: 'mkdir', path | paths }.
    const op = !flat ? entry[kind] : kind === 'delete' || kind === 'mkdir' ? rest.paths ?? rest.path ?? rest.file : rest;
    if (kind === 'replace') replaceOp(dir, op ?? {}, where, legacyOps);
    else if (kind === 'json') jsonOp(dir, op ?? {}, where, legacyOps);
    else if (kind === 'write') writeOp(dir, op ?? {}, where);
    else if (kind === 'delete') {
      for (const rel of [op].flat()) rmSync(mustExist(dir, rel, where, 'delete path'), { recursive: true, force: true });
    } else if (kind === 'rename') {
      const from = mustExist(dir, op?.from, where, 'rename.from');
      const to = insidePath(dir, op?.to, where, 'rename.to');
      if (lstatSync(to, { throwIfNoEntry: false }) !== undefined) {
        if (op.overwrite !== true) throw new OverlayError(`${where}: ${op.to} already exists; add "overwrite": true or rename to a free path`);
        rmSync(to, { recursive: true, force: true });
      }
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    } else if (kind === 'copy') {
      const from = mustExist(dir, op?.from, where, 'copy.from');
      const to = insidePath(dir, op?.to, where, 'copy.to');
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    } else if (kind === 'png') {
      const files = op?.files ?? (op?.file === undefined ? [] : [op.file]);
      if (!Array.isArray(files) || files.length === 0) throw new OverlayError(`${where}: png needs "file" or "files"`);
      let bytes;
      try {
        bytes = encodePng(renderPng(op));
      } catch (error) {
        throw new OverlayError(`${where}: ${error.message}`);
      }
      for (const rel of files) writeInside(insidePath(dir, rel, where, 'png file'), bytes);
    } else if (kind === 'reformat') {
      const path = mustExist(dir, op?.file, where, 'reformat.file');
      let data;
      try {
        data = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        throw new OverlayError(`${where}: ${op.file} is not valid JSON (${String(error.message).split('\n')[0]})`);
      }
      writeFileSync(path, `${JSON.stringify(data, null, op.indent ?? 2)}\n`);
    } else if (kind === 'mkdir') {
      for (const rel of [op].flat()) mkdirSync(insidePath(dir, rel, where, 'mkdir path'), { recursive: true });
    } else if (kind === 'symlink') {
      const path = insidePath(dir, op?.path, where, 'symlink.path');
      if (typeof op.target !== 'string' || op.target === '') throw new OverlayError(`${where}: symlink needs a "target" string`);
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(op.target, path);
    } else if (kind === 'plant') plantOp(dir, op, where);
  }
}

/** Rename every file or folder named like a HYGIENE_RENAMES key inside dir (deepest first). */
function renameTree(dir, renames) {
  if (!renames || Object.keys(renames).length === 0 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) renameTree(abs, renames);
    const target = renames[entry.name];
    if (target !== undefined && target !== entry.name) {
      const to = join(dir, target);
      rmSync(to, { recursive: true, force: true });
      renameSync(abs, to);
    }
  }
}

/** Every file under dir (symlinks included, not followed), as sorted relative posix paths. */
function listTree(dir) {
  const out = [];
  const visit = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(join(abs, entry.name), childRel);
      else out.push(childRel);
    }
  };
  visit(dir, '');
  return out;
}

/** The repo path a template names on its first line ("// src/ui/app-text.tsx", "# .maestro/smoke.yaml"), or null. */
function firstLinePath(text) {
  const lines = text.split('\n', 3);
  const line = lines[0].startsWith('#!') ? lines[1] ?? '' : lines[0];
  const match = /^\s*(?:\/\/+|#+|\/\*+|<!--|--|;+)\s*(\S+)/.exec(line);
  if (!match) return null;
  const token = match[1].replace(/\s*(?:\*\/|-->)$/, '');
  if (token.includes('://') || token.startsWith('/') || token.split('/').includes('..') || !/^[\w@.[\]()+-]+(?:\/[\w@.[\]()+-]+)*$/.test(token)) return null;
  if (!token.includes('/') && !/\.\w+$/.test(token)) return null;
  return token;
}

function fillText(text, fill) {
  return Object.entries(fill).reduce((out, [from, to]) => out.replaceAll(from, String(to)), text);
}

/**
 * Normalize one base entry: 'path' | { from, to, fill, firstLinePath, include, exclude, optional }
 * | { build(dir, context) } (JS only) | { templates: true, ... } (the skill's templates/).
 * Paths: absolute, '@skill/<path>' (the skill folder), '@tests/<path>' (<skill>/tests), or relative to
 * the suite folder.
 */
function normalizeBaseEntry(entry, { suiteDir, skillDir }) {
  const where = (path) => {
    if (typeof path !== 'string' || path.trim() === '') throw new OverlayError(`a base entry needs a folder path, got ${JSON.stringify(path)}`);
    if (isAbsolute(path)) return path;
    if (path === '@skill' || path.startsWith('@skill/')) return join(skillDir, path.slice(7));
    if (path === '@tests' || path.startsWith('@tests/')) return join(skillDir, 'tests', path.slice(7));
    return resolve(suiteDir, path);
  };
  if (typeof entry === 'string') return { from: where(entry), to: '.' };
  if (!isPlainObject(entry)) throw new OverlayError(`a base entry is a folder path or an object, got ${JSON.stringify(entry)}`);
  if (typeof entry.build === 'function') return { build: entry.build, to: entry.to ?? '.' };
  const from = entry.templates === true ? join(skillDir, 'templates') : where(entry.from);
  return { ...entry, from, to: entry.to ?? '.' };
}

function copyBaseEntry(entry, target, label) {
  const { from } = entry;
  const stat = lstatSync(from, { throwIfNoEntry: false });
  if (stat === undefined) {
    if (entry.optional) return;
    throw new OverlayError(`${label}: base ${toPosix(from)} does not exist`);
  }
  const destRoot = entry.to === '.' ? target : insidePath(target, entry.to, label, 'base "to"');
  if (!stat.isDirectory()) {
    const dest = entry.to === '.' || entry.to.endsWith('/') ? join(destRoot, basename(from)) : destRoot;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(from, dest, { verbatimSymlinks: true });
    return;
  }
  const plain = !entry.fill && !entry.firstLinePath && !entry.include && !entry.exclude;
  const overlay = join(from, OVERLAY_DIR);
  const hasOverlay = existsSync(overlay) && statSync(overlay).isDirectory();
  if (plain) {
    mkdirSync(destRoot, { recursive: true });
    cpSync(from, destRoot, { recursive: true, verbatimSymlinks: true, filter: (src) => !(dirname(src) === from && isRootControl(basename(src))) });
    // A base folder's overlay/ (for example a data file named mutation.json) lands at the root.
    if (hasOverlay) cpSync(overlay, destRoot, { recursive: true, verbatimSymlinks: true });
    return;
  }
  const all = listTree(from);
  const ordered = [...all.filter((rel) => !rel.startsWith(`${OVERLAY_DIR}/`)), ...all.filter((rel) => rel.startsWith(`${OVERLAY_DIR}/`))];
  for (const listed of ordered) {
    if (!listed.includes('/') && isRootControl(listed)) continue;
    const rel = listed.startsWith(`${OVERLAY_DIR}/`) ? listed.slice(OVERLAY_DIR.length + 1) : listed;
    const abs = join(from, listed);
    if (entry.include && !entry.include.some((glob) => matchGlob(rel, glob))) continue;
    if (entry.exclude && entry.exclude.some((glob) => matchGlob(rel, glob))) continue;
    const buffer = lstatSync(abs).isSymbolicLink() ? null : readFileSync(abs);
    const text = buffer !== null && !isBinary(buffer) ? buffer.toString('utf8') : null;
    let destRel = rel;
    if (entry.firstLinePath && text !== null) {
      const named = firstLinePath(entry.fill ? fillText(text, entry.fill) : text);
      if (named !== null) destRel = named;
      else destRel = entry.to === '.' ? rel : `${toPosix(entry.to)}/${rel}`;
    } else {
      destRel = entry.to === '.' ? rel : `${toPosix(entry.to)}/${rel}`;
    }
    if (entry.fill) destRel = fillText(destRel, entry.fill);
    const dest = insidePath(target, destRel, label, 'a template path');
    mkdirSync(dirname(dest), { recursive: true });
    if (buffer === null) cpSync(abs, dest, { verbatimSymlinks: true });
    else writeFileSync(dest, text !== null && entry.fill ? fillText(text, entry.fill) : buffer);
  }
}

/**
 * The assembly spec of one suite folder: SUITE.json merged with `overrides` (a runSelftest suite's
 * own base / extends / ops / argsFile / legacyOps / renames, which win). Returns null when neither
 * declares anything and the suite has no base/ folder (the suite's cases are complete trees and run in
 * place, as before). A base/ folder in the suite declares itself as the base, and a CASES.json makes the
 * suite assembled too (its `cases`: { "<case>": { ops, args, base?, extends? } }).
 * SUITE.json keys:
 *   base       a folder or a list of layers copied in order (default: the suite's base/ folder when it
 *              has one, else "good": the suite's good/)
 *   extends    a case name ("good"): every other case starts from that case's assembled tree
 *   ops        ops applied to the base once, before any case (for example png ops)
 *   argsFile   "replace" (default: ARGS.txt replaces the suite's args for every case kind),
 *              "append" (args(dir) then ARGS.txt), or "error-only" (the pre-overlay rule)
 *   legacyOps  "all" | "first" (see applyMutation)
 *   renames    extra hygiene renames ({ "dot-npmrc": ".npmrc" }), or false for none
 */
export function readSuiteSpec(suiteDir, overrides = {}) {
  const file = join(suiteDir, SUITE_FILE);
  let spec = null;
  if (existsSync(file)) {
    try {
      spec = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new OverlayError(`${SUITE_FILE} is not valid JSON (${String(error.message).split('\n')[0]})`);
    }
    if (!isPlainObject(spec)) throw new OverlayError(`${SUITE_FILE} must hold one object`);
    const unknown = Object.keys(spec).filter((key) => !SUITE_KEYS.has(key));
    if (unknown.length > 0) throw new OverlayError(`${SUITE_FILE} has unknown keys: ${unknown.join(', ')} (known: ${[...SUITE_KEYS].join(', ')})`);
  }
  const given = Object.fromEntries(['base', 'extends', 'ops', 'argsFile', 'legacyOps', 'renames'].filter((key) => overrides?.[key] !== undefined).map((key) => [key, overrides[key]]));
  // A suite folder with a base/ folder declares it as the base, even without SUITE.json.
  const hasBaseDir = existsSync(join(suiteDir, SUITE_BASE_DIR)) && statSync(join(suiteDir, SUITE_BASE_DIR)).isDirectory();
  const cases = readCasesFile(suiteDir);
  if (spec === null && Object.keys(given).length === 0 && !hasBaseDir && cases === null) return null;
  const merged = { ...(spec ?? {}), ...given };
  if (merged.argsFile !== undefined && !ARGS_FILE_MODES.includes(merged.argsFile)) throw new OverlayError(`${SUITE_FILE} "argsFile" must be one of ${ARGS_FILE_MODES.join(', ')}`);
  if (merged.legacyOps !== undefined && merged.legacyOps !== null && !['all', 'first'].includes(merged.legacyOps)) throw new OverlayError(`${SUITE_FILE} "legacyOps" must be "all" or "first"`);
  if (merged.ops !== undefined && !Array.isArray(merged.ops)) throw new OverlayError(`${SUITE_FILE} "ops" must be a list of ops`);
  if (merged.extends !== undefined && merged.extends !== null && typeof merged.extends !== 'string') throw new OverlayError(`${SUITE_FILE} "extends" must be a case name`);
  const renames = merged.renames === false ? {} : { ...HYGIENE_RENAMES, ...(isPlainObject(merged.renames) ? merged.renames : {}) };
  return {
    base: merged.base === undefined ? [hasBaseDir ? SUITE_BASE_DIR : 'good'] : [merged.base].flat(),
    extends: merged.extends ?? null,
    ops: merged.ops ?? [],
    argsFile: merged.argsFile ?? 'replace',
    legacyOps: merged.legacyOps ?? null,
    renames,
    cases: cases ?? {},
    file: spec === null ? null : file,
  };
}

/**
 * A suite's CASES.json ({ "<case>": [ops] | { ops, base, extends, args } }), or null when it has none.
 * Each entry is checked for shape here; that each key names a case folder is checked at assembly.
 */
/** EXPECT.txt's text from a CASES.json "expect" (a list of lines, or the exact text); undefined when it is neither. */
function expectText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((line) => typeof line === 'string')) return `${value.join('\n')}\n`;
  return undefined;
}

function readCasesFile(suiteDir) {
  const file = join(suiteDir, CASES_FILE);
  if (!existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new OverlayError(`${CASES_FILE} is not valid JSON (${String(error.message).split('\n')[0]})`);
  }
  if (!isPlainObject(data)) throw new OverlayError(`${CASES_FILE} must hold one object: { "<case>": [ops] | { "ops": [...], "args": "...", "expect": [...] } }`);
  const out = {};
  for (const [name, entry] of Object.entries(data)) {
    if (name === '$comment') continue;
    if (selftestCaseKind(name) === null) throw new OverlayError(`${CASES_FILE} key "${name}" is not a case name (good, pass-*, bad-*, error-*)`);
    if (Array.isArray(entry)) {
      out[name] = { ops: entry, args: null, expect: null };
      continue;
    }
    if (!isPlainObject(entry)) throw new OverlayError(`${CASES_FILE} "${name}" must be a list of ops or { "ops": [...], "args": "...", "expect": [...] }`);
    const unknown = Object.keys(entry).filter((key) => ![...MUTATION_KEYS, 'args', 'expect'].includes(key));
    if (unknown.length > 0) throw new OverlayError(`${CASES_FILE} "${name}" has unknown keys: ${unknown.join(', ')}`);
    if (entry.ops !== undefined && !Array.isArray(entry.ops)) throw new OverlayError(`${CASES_FILE} "${name}" "ops" must be a list of ops`);
    const args = entry.args === undefined ? null : Array.isArray(entry.args) && entry.args.every((word) => typeof word === 'string') ? entry.args.join(' ') : typeof entry.args === 'string' ? entry.args : undefined;
    if (args === undefined) throw new OverlayError(`${CASES_FILE} "${name}" "args" must be a string (ARGS.txt's words) or a list of strings`);
    const expect = entry.expect === undefined ? null : expectText(entry.expect);
    if (expect === undefined) throw new OverlayError(`${CASES_FILE} "${name}" "expect" must be a list of lines (EXPECT.txt's lines) or a string`);
    out[name] = { ops: entry.ops ?? [], args, expect, ...('base' in entry ? { base: [entry.base].flat() } : {}), ...('extends' in entry ? { extends: entry.extends } : {}) };
  }
  return out;
}

/** The names of a suite's CASES.json entries that carry "expect" (cases that need no folder); [] without a CASES.json or when it does not parse (assembly reports that). */
function readInlineCaseNames(suiteDir) {
  try {
    const data = JSON.parse(readFileSync(join(suiteDir, CASES_FILE), 'utf8'));
    return isPlainObject(data) ? Object.entries(data).filter(([name, entry]) => name !== '$comment' && isPlainObject(entry) && entry.expect !== undefined && selftestCaseKind(name) !== null).map(([name]) => name) : [];
  } catch {
    return [];
  }
}

/** The nearest folder at or above `start` that holds a SKILL.md (the skill folder), else `start`'s parent. */
function findSkillDir(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'SKILL.md'))) return dir;
    const up = dirname(dir);
    if (up === dir) return dirname(resolve(start));
    dir = up;
  }
}

/** A case's mutation.json: a list of ops, or { base?, extends?, ops }. */
function readMutationFile(source, name, casesEntry = null) {
  const path = join(source, MUTATION_FILE);
  if (casesEntry !== null) {
    if (existsSync(path)) throw new OverlayError(`${name}: has both ${MUTATION_FILE} and an entry in the suite's ${CASES_FILE}; keep one`);
    const { args, expect, ...mutation } = casesEntry;
    return mutation;
  }
  if (!existsSync(path)) return { ops: [] };
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new OverlayError(`${name}: ${MUTATION_FILE} is not valid JSON (${String(error.message).split('\n')[0]})`);
  }
  if (Array.isArray(data)) return { ops: data };
  if (!isPlainObject(data)) throw new OverlayError(`${name}: ${MUTATION_FILE} must be a list of ops or { "ops": [...] }`);
  const unknown = Object.keys(data).filter((key) => !MUTATION_KEYS.includes(key));
  if (unknown.length > 0) throw new OverlayError(`${name}: ${MUTATION_FILE} has unknown keys: ${unknown.join(', ')}`);
  return { ops: data.ops ?? [], ...('base' in data ? { base: [data.base].flat() } : {}), ...('extends' in data ? { extends: data.extends } : {}) };
}

function readDeleteList(source) {
  const path = join(source, DELETE_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));
}

/** Exact-name check (a case-insensitive disk must not mistake args.txt for ARGS.txt). */
function hasEntry(dir, name) {
  try {
    return readdirSync(dir).includes(name);
  } catch {
    return false;
  }
}

/** Run every { build } base entry once into a cache folder, so assembly itself is synchronous. */
async function prepareBuilds(entries, cacheDir, context) {
  const out = [];
  for (const entry of entries) {
    if (entry.build) {
      const dir = mkdtempSync(join(cacheDir, 'build-'));
      await entry.build(dir, context);
      out.push({ from: dir, to: entry.to ?? '.' });
    } else out.push(entry);
  }
  return out;
}

/**
 * Assemble every case of one suite into `into` (a folder that exists), synchronously. Returns
 * [{ name, kind, source, dir, error, args, expect }] in name order (`args` and `expect`: the case's "args"
 * and "expect" text from CASES.json, else null; `source` may not exist for a case that lives only there); `error` is the OverlayError text of a case
 * whose base or ops did not apply (dir is then null). Per case, in order:
 *   1. the start tree: the case it extends (assembled, its EXPECT.txt/ARGS.txt left out), or else
 *      the base layers (case-local and control files at a layer's root left out) + the suite ops;
 *      hygiene renames applied. A case's own mutation.json "extends" wins; its own "base" replaces
 *      the suite base and drops the suite's extends (suite ops belong to the suite base)
 *   2. DELETE.txt: one path per line (# comments), each must exist
 *   3. overlay files: every other file of the case folder, then the contents of its overlay/ folder,
 *      copied on top (renames applied); skipped when the case folder is itself a base layer (a base
 *      folder's own overlay/ is merged at its root, so a data file named like a control file can live there)
 *   4. mutation.json ops (or the case's entry in the suite's CASES.json, never both), then a legacy plant.json
 *   5. the case's own EXPECT.txt and ARGS.txt (or its CASES.json "expect" and "args", written as EXPECT.txt
 *      and ARGS.txt). A CASES.json key with "expect" is a case of its own, with or without a case folder
 * options: { suiteDir, skillDir, into, spec (readSuiteSpec), only: (name) => boolean }. Base entries
 * must already be folders (runSelftest runs { build } entries first).
 */
export function assembleSuiteCases({ suiteDir, skillDir, into, spec, only = () => true }) {
  const folders = readdirSync(suiteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && selftestCaseKind(entry.name) !== null)
    .map((entry) => entry.name);
  const context = { suiteDir: resolve(suiteDir), skillDir: resolve(skillDir ?? findSkillDir(suiteDir)) };
  const cases = spec.cases ?? {};
  const stale = Object.keys(cases).filter((name) => !folders.includes(name) && cases[name].expect == null);
  if (stale.length > 0) throw new OverlayError(`${CASES_FILE} names ${stale.join(', ')}, which ${stale.length === 1 ? 'is not a case folder' : 'are not case folders'} of this suite and ${stale.length === 1 ? 'has' : 'have'} no "expect" (give the entry its EXPECT.txt lines as "expect", or add the folder)`);
  const names = [...new Set([...folders, ...Object.keys(cases)])].sort();
  const baseCache = new Map();
  const built = new Map();
  const visiting = new Set();
  const results = new Map();
  let baseCount = 0;

  const buildBase = (rawEntries, withSuiteOps) => {
    const entries = rawEntries.map((entry) => (entry.from && isAbsolute(entry.from) && !entry.build ? entry : normalizeBaseEntry(entry, context)));
    const key = JSON.stringify([entries.map(({ build, ...rest }) => rest), withSuiteOps]);
    if (baseCache.has(key)) return { dir: baseCache.get(key), entries };
    baseCount += 1;
    const dir = join(into, `.base-${baseCount}`);
    mkdirSync(dir, { recursive: true });
    for (const entry of entries) {
      if (entry.build) throw new OverlayError('a { build } base entry needs runSelftest (or await prepareBuilds) to run it first');
      copyBaseEntry(entry, dir, 'base');
    }
    renameTree(dir, spec.renames);
    if (withSuiteOps && spec.ops.length > 0) applyMutation(dir, spec.ops, `${SUITE_FILE} ops`, { legacyOps: spec.legacyOps });
    baseCache.set(key, dir);
    return { dir, entries };
  };

  const assemble = (name) => {
    if (built.has(name)) return built.get(name);
    if (visiting.has(name)) throw new OverlayError(`${name}: "extends" loops back to ${name}`);
    visiting.add(name);
    const source = join(suiteDir, name);
    const target = join(into, name);
    try {
      const casesEntry = cases[name] ?? null;
      if (casesEntry?.args != null && hasEntry(source, 'ARGS.txt')) throw new OverlayError(`${name}: has both ARGS.txt and "args" in the suite's ${CASES_FILE}; keep one`);
      if (casesEntry?.expect != null && hasEntry(source, 'EXPECT.txt')) throw new OverlayError(`${name}: has both EXPECT.txt and "expect" in the suite's ${CASES_FILE}; keep one`);
      const mutation = readMutationFile(source, name, casesEntry);
      // The case's own "extends" wins, then its own "base" (which drops the suite's extends), then the suite's.
      const parent = mutation.extends !== undefined ? mutation.extends : mutation.base !== undefined ? null : spec.extends !== null && spec.extends !== name ? spec.extends : null;
      let ownBase = false;
      if (parent !== null) {
        if (!names.includes(parent)) throw new OverlayError(`${name}: extends "${parent}", which is not a case of this suite`);
        if (parent === name) throw new OverlayError(`${name}: a case cannot extend itself`);
        let parentDir;
        try {
          parentDir = assemble(parent);
        } catch (error) {
          throw new OverlayError(`${name}: extends ${parent}, which did not assemble (${error.message})`);
        }
        cpSync(parentDir, target, { recursive: true, verbatimSymlinks: true, filter: (src) => !(dirname(src) === parentDir && CASE_LOCAL_FILES.includes(basename(src))) });
      } else {
        const { dir, entries } = buildBase(mutation.base ?? spec.base, mutation.base === undefined);
        ownBase = entries.some((entry) => !entry.build && resolve(entry.from) === resolve(source) && entry.to === '.' && !entry.fill && !entry.firstLinePath && !entry.include && !entry.exclude);
        cpSync(dir, target, { recursive: true, verbatimSymlinks: true });
      }
      mkdirSync(target, { recursive: true });
      for (const rel of readDeleteList(source)) rmSync(mustExist(target, rel, `${name}: ${DELETE_FILE}`, 'a path'), { recursive: true, force: true });
      if (!ownBase && existsSync(source)) {
        // Overlay files: the case's loose files, then the contents of its overlay/ folder.
        cpSync(source, target, { recursive: true, verbatimSymlinks: true, filter: (src) => !(dirname(src) === source && isRootControl(basename(src))) });
        const overlay = join(source, OVERLAY_DIR);
        if (existsSync(overlay) && statSync(overlay).isDirectory()) cpSync(overlay, target, { recursive: true, verbatimSymlinks: true });
        renameTree(target, spec.renames);
      }
      applyMutation(target, mutation.ops, `${name}: ${casesEntry !== null ? CASES_FILE : MUTATION_FILE}`, { legacyOps: spec.legacyOps });
      if (existsSync(join(source, PLANT_FILE))) {
        let plant;
        try {
          plant = JSON.parse(readFileSync(join(source, PLANT_FILE), 'utf8'));
        } catch (error) {
          throw new OverlayError(`${name}: ${PLANT_FILE} is not valid JSON (${String(error.message).split('\n')[0]})`);
        }
        plantOp(target, plant, `${name}: ${PLANT_FILE}`);
      }
      for (const file of CASE_LOCAL_FILES) if (hasEntry(source, file)) copyFileSync(join(source, file), join(target, file));
      if (casesEntry?.args != null) writeFileSync(join(target, 'ARGS.txt'), `${casesEntry.args.trim()}\n`);
      if (casesEntry?.expect != null) writeFileSync(join(target, 'EXPECT.txt'), casesEntry.expect);
      built.set(name, target);
      return target;
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      throw error instanceof OverlayError ? error : new OverlayError(`${name}: ${error.message}`);
    } finally {
      visiting.delete(name);
    }
  };

  for (const name of names.filter((candidate) => only(candidate))) {
    try {
      results.set(name, { name, kind: selftestCaseKind(name), source: join(suiteDir, name), dir: assemble(name), error: null, args: cases[name]?.args ?? null, expect: cases[name]?.expect ?? null });
    } catch (error) {
      results.set(name, { name, kind: selftestCaseKind(name), source: join(suiteDir, name), dir: null, error: error.message, args: null, expect: cases[name]?.expect ?? null });
    }
  }
  return [...results.values()];
}

/**
 * Assemble one suite into a new temporary folder and return its path (the caller removes it with
 * removeTempDir); throws OverlayError on the first case that does not assemble. A drop-in for the
 * older per-skill assemblers:
 *   assembleSuite({ suiteDir, base, extends, ops, legacyOps, renames, skillDir, prefix })
 *   assembleSuite({ suiteDir, templates, extraCopies: [[from, to]], baseRepo, prefix })   (older form:
 *       layers templates, then each extra copy, then baseRepo)
 *   assembleSuite(baseRepoOrBases, suiteDir)                                             (older positional form)
 * The two older forms default to legacyOps 'all' (the behaviour of the per-skill copies they replace).
 * Every case kind (good, pass-*, bad-*, error-*) is assembled. { build } entries are not allowed
 * here (use runSelftest, which awaits them).
 */
export function assembleSuite(optionsOrBases, maybeSuiteDir) {
  const positional = typeof optionsOrBases === 'string' || Array.isArray(optionsOrBases);
  const options = positional ? { base: [optionsOrBases].flat(), suiteDir: maybeSuiteDir } : { ...optionsOrBases };
  if (typeof options.suiteDir !== 'string') throw new OverlayError('assembleSuite needs suiteDir');
  const older = positional || (options.base === undefined && Boolean(options.templates || options.baseRepo || options.extraCopies));
  // The older call forms keep the older ops: replace every occurrence, a json delete of a missing key passes.
  if (older && options.legacyOps === undefined) options.legacyOps = 'all';
  if (options.base === undefined && (options.templates || options.baseRepo || options.extraCopies)) {
    options.base = [
      ...(options.templates ? [options.templates] : []),
      ...(options.extraCopies ?? []).map(([from, to]) => ({ from, to })),
      ...(options.baseRepo ? [options.baseRepo] : []),
    ];
  }
  const spec = readSuiteSpec(options.suiteDir, { base: options.base ?? [], extends: options.extends, ops: options.ops, legacyOps: options.legacyOps, renames: options.renames });
  const tmp = makeTempDir(options.prefix ?? 'skill-fixtures-');
  try {
    const cases = assembleSuiteCases({ suiteDir: options.suiteDir, skillDir: options.skillDir, into: tmp, spec });
    const failed = cases.find((entry) => entry.error !== null);
    if (failed) throw new OverlayError(failed.error);
    for (const entry of readdirSync(tmp)) if (entry.startsWith('.base-')) rmSync(join(tmp, entry), { recursive: true, force: true });
    return tmp;
  } catch (error) {
    removeTempDir(tmp);
    throw error;
  }
}

/**
 * The older "build the base repo, then mutate it" form: build(dir) writes the base repo (it may be
 * async; then this returns a Promise), and every case folder of mutationsDir (pass-*, bad-*, error-*,
 * and good/ when it has ops of its own; each holding mutation.json and EXPECT.txt) becomes a copy of
 * that base with its ops applied. Without a good/ folder, good is the base itself. Returns the
 * temporary folder. options: { prefix, legacyOps (default 'first', the older behaviour) }.
 */
export function assembleFixtures(mutationsDir, build, { prefix = 'skill-fixtures-', legacyOps = 'first' } = {}) {
  const out = makeTempDir(prefix);
  const base = join(out, '.base');
  mkdirSync(base);
  const finish = () => {
    const spec = { base: [base], extends: null, ops: [], argsFile: 'replace', legacyOps, renames: { ...HYGIENE_RENAMES }, file: null };
    const work = join(out, '.work');
    mkdirSync(work);
    try {
      const cases = assembleSuiteCases({ suiteDir: mutationsDir, into: work, spec });
      const failed = cases.find((entry) => entry.error !== null);
      if (failed) throw new OverlayError(failed.error);
      for (const entry of cases) renameSync(entry.dir, join(out, entry.name));
      if (!cases.some((entry) => entry.name === 'good')) renameSync(base, join(out, 'good'));
      rmSync(work, { recursive: true, force: true });
      rmSync(base, { recursive: true, force: true });
      return out;
    } catch (error) {
      removeTempDir(out);
      throw error;
    }
  };
  let result;
  try {
    result = build(base);
  } catch (error) {
    removeTempDir(out);
    throw error;
  }
  if (result && typeof result.then === 'function') {
    return result.then(finish, (error) => {
      removeTempDir(out);
      throw error;
    });
  }
  return finish();
}

// ---------------------------------------------------------------------------------------------
// Self-test runner (used by scripts/selftest.mjs)
// ---------------------------------------------------------------------------------------------

function lastLine(text) {
  const lines = text.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  return lines.at(-1) ?? '';
}

function runNode(script, args, cwd, timeoutMs) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, stdout: result.stdout ?? '', timedOut: result.error?.code === 'ETIMEDOUT' };
}

function tail(text, count = 8) {
  return text.trimEnd().split('\n').slice(-count).map((line) => `      | ${line}`).join('\n');
}

/** The fixture kinds runSelftest runs, by folder-name prefix: what each must do. */
export const SELFTEST_CASES = Object.freeze({
  good: Object.freeze({ exit: EXIT.PASS, expect: 'optional', meaning: 'clean input: exit 0 with RESULT: PASS' }),
  'pass-': Object.freeze({ exit: EXIT.PASS, expect: 'required', meaning: 'a passing case: exit 0 with RESULT: PASS and every EXPECT.txt line (a SKIP line, a NOT APPLICABLE fact, a note)' }),
  'bad-': Object.freeze({ exit: EXIT.FAIL, expect: 'required', meaning: 'a planted bug: exit 1 with every EXPECT.txt line (the rule id, file:line)' }),
  'error-': Object.freeze({ exit: EXIT.BAD_INPUT, expect: 'required', meaning: 'bad input or environment: exit 2 with every EXPECT.txt line (the ERROR text)' }),
});

/** The kind of one fixture folder ('good', 'pass-', 'bad-', 'error-'), or null for a folder runSelftest ignores. */
export function selftestCaseKind(name) {
  if (name === 'good') return 'good';
  for (const prefix of ['pass-', 'bad-', 'error-']) if (name.startsWith(prefix) && name.length > prefix.length) return prefix;
  return null;
}

const SELFTEST_DETAILS = [
  'Case kinds (folder-name prefix): good/ exits 0; pass-<case>/ exits 0 and prints every EXPECT.txt line;',
  'bad-<case>/ exits 1 and prints every EXPECT.txt line; error-<case>/ exits 2 and prints every EXPECT.txt line.',
  `A suite folder with ${SUITE_FILE} is assembled: each case is its base plus ${DELETE_FILE}, its overlay files and`,
  `its ${MUTATION_FILE} ops (or its entry in the suite's ${CASES_FILE}), built in a temporary folder that is removed afterwards. Every op must apply, so a stale`,
  'fixture fails (selftest-assemble). --materialize writes the assembled cases for inspection instead of running them.',
].join('\n');

/**
 * Prove each checker on its fixture folders, one kind per folder-name prefix:
 *   good/          exits 0 and ends with RESULT: PASS (EXPECT.txt optional)
 *   pass-<case>/   exits 0, ends with RESULT: PASS and prints every line of its EXPECT.txt
 *   bad-<case>/    exits 1 with a RESULT line and prints every line of its EXPECT.txt (a suite needs one)
 *   error-<case>/  exits 2 with a RESULT line and prints every line of its EXPECT.txt
 * Each non-empty EXPECT.txt line must appear in the output.
 *
 *   // scripts/selftest.mjs
 *   import { runSelftest } from './check-lib.mjs';
 *   await runSelftest(import.meta.url, [
 *     { script: 'check-exports.mjs', fixtures: '../tests/fixtures/check-exports', args: (dir) => [dir] },
 *   ]);
 *
 * Suite fields: script and fixtures (relative to the selftest file, or absolute); args(dir, context)
 * builds the arguments for one case (default none; the checker runs with the case folder as its
 * working directory; context = { name, kind, source, suiteDir, argsTxt }). Overlay suites: a suite
 * folder with SUITE.json, or a suite with any of base / extends / ops / legacyOps / renames (see
 * readSuiteSpec; base entries may also be { build: async (dir) => {} } here) is assembled into a
 * temporary folder first (assembleSuiteCases), so args(dir) gets the assembled case folder.
 * ARGS.txt: argsFile 'replace' (the default for overlay suites) makes its words replace args(dir)
 * for every case kind; 'append' adds them after args(dir); 'error-only' (the default for suites
 * that are not assembled) uses it for error-* cases only. "{dir}" in ARGS.txt is the case folder.
 * Options: { timeoutMs = 120000, base } (base: the default base for suites without one of their own,
 * which turns them into overlay suites). Command line: --materialize <dir> writes every assembled
 * case to <dir>/<NN>-<suite>/<case> and stops; --case <glob> runs only matching cases.
 * Also checks that --help exits 0. When every good, pass and bad case stops with the same exit-2
 * error, the environment is not ready (a package is not installed): the self-test says that once
 * and exits 2. error-* cases are meant to exit 2 and never count towards that.
 */
export async function runSelftest(selftestUrl, suites, { timeoutMs = 120000, base: defaultBase } = {}) {
  await run(async () => {
    const { options } = parseArgs(process.argv.slice(2), {
      name: 'selftest',
      summary: 'Runs every checker of this skill on tests/fixtures: good/ and pass-*/ must pass (exit 0), each bad-*/ must fail (exit 1) and each error-*/ must stop (exit 2), each printing every line of its EXPECT.txt.',
      usage: '[options]',
      options: {
        materialize: { type: 'string', value: 'dir', help: 'Write every assembled case into <dir>/<NN>-<suite>/<case> for inspection, then stop (no checker runs)' },
        case: { type: 'string', multiple: true, value: 'glob', help: 'Run only the cases whose folder name matches the glob (for example bad-*)' },
      },
      positionals: { min: 0, max: 0 },
      details: SELFTEST_DETAILS,
    });
    const here = dirname(fileURLToPath(selftestUrl));
    const skillDir = dirname(here);
    if (!Array.isArray(suites) || suites.length === 0) throw new UsageError('runSelftest needs at least one suite', 'Pass [{ script, fixtures, args }].');
    const filters = options.case ?? [];
    const only = (name) => filters.length === 0 || filters.some((glob) => globToRegExp(glob).test(name));
    const materialize = options.materialize ? resolve(options.materialize) : null;
    if (materialize && existsSync(materialize) && readdirSync(materialize).length > 0) {
      throw new UsageError(`--materialize ${options.materialize} is not empty`, 'Pass a new or empty folder.');
    }
    const report = createReporter({ name: 'selftest' });
    let work = null;
    const workDir = () => {
      if (work === null) work = makeTempDir('selftest-');
      return work;
    };
    let runs = 0;
    let materialized = 0;
    try {
      for (const [index, suite] of suites.entries()) {
        const script = resolve(here, suite.script);
        const fixtures = resolve(here, suite.fixtures ?? '../tests/fixtures');
        const args = suite.args ?? (() => []);
        const label = basename(script);
        const suiteLabel = `${String(index + 1).padStart(2, '0')}-${basename(fixtures)}`;
        if (!existsSync(script)) {
          report.problem({ file: suite.script, rule: 'selftest-script', message: `checker ${label} not found`, fix: 'Point the suite at an existing script in scripts/.' });
          continue;
        }
        if (!materialize) {
          const help = runNode(script, ['--help'], here, timeoutMs);
          runs += 1;
          if (help.status !== 0 || !/Usage:/.test(help.output)) {
            report.problem({ file: label, rule: 'selftest-help', message: `--help exited ${help.status} or printed no "Usage:" line`, fix: 'Use parseArgs() from check-lib so --help prints usage and exits 0.' });
          } else {
            console.log(`ok   ${label} --help`);
          }
        }
        if (!existsSync(fixtures)) {
          report.problem({ file: toPosix(relative(here, fixtures)), rule: 'selftest-fixtures', message: 'fixtures folder not found', fix: 'Create tests/fixtures/good and tests/fixtures/bad-<case>/ with EXPECT.txt.' });
          continue;
        }
        let dirs = readdirSync(fixtures, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
        // Cases that live only in CASES.json (their "expect" inline) count as cases of the suite.
        const inline = readInlineCaseNames(fixtures);
        if (inline.length > 0) dirs = [...new Set([...dirs, ...inline])].sort();
        const bad = dirs.filter((name) => selftestCaseKind(name) === 'bad-');
        if (filters.length === 0) {
          if (!dirs.includes('good')) {
            report.problem({ file: toPosix(relative(here, fixtures)), rule: 'selftest-fixtures', message: 'no good/ fixture', fix: 'Add tests/fixtures/good/ with input the checker must pass.' });
          }
          if (bad.length === 0) {
            report.problem({ file: toPosix(relative(here, fixtures)), rule: 'selftest-fixtures', message: 'no bad-* fixture: a check that has only ever passed proves nothing', fix: 'Add tests/fixtures/bad-<case>/ with a planted bug and an EXPECT.txt.' });
          }
        }
        // Overlay suites are assembled first; a case whose ops do not apply fails loudly.
        let spec = null;
        let assembled = null;
        try {
          const overrides = { base: suite.base ?? (existsSync(join(fixtures, SUITE_FILE)) ? undefined : defaultBase), extends: suite.extends, ops: suite.ops, argsFile: suite.argsFile, legacyOps: suite.legacyOps, renames: suite.renames };
          spec = readSuiteSpec(fixtures, overrides);
          if (spec !== null) {
            const into = join(workDir(), suiteLabel);
            mkdirSync(into, { recursive: true });
            const context = { suiteDir: fixtures, skillDir };
            spec.base = await prepareBuilds(spec.base.map((entry) => normalizeBaseEntry(entry, context)), workDir(), context);
            assembled = new Map(assembleSuiteCases({ suiteDir: fixtures, skillDir, into, spec, only }).map((entry) => [entry.name, entry]));
          }
        } catch (error) {
          if (!(error instanceof OverlayError)) throw error;
          report.problem({ file: toPosix(relative(here, fixtures)), rule: 'selftest-assemble', message: `${label} ${basename(fixtures)}: ${error.message}`, fix: `Fix ${SUITE_FILE} or the base it names so every case can be assembled.` });
          continue;
        }
        if (assembled !== null) {
          for (const entry of assembled.values()) {
            if (entry.error !== null) {
              report.problem({ file: toPosix(relative(here, entry.source)), rule: 'selftest-assemble', message: `${label} ${entry.name}: ${entry.error}`, fix: `Update the case's ${MUTATION_FILE} / ${DELETE_FILE} / overlay files so they apply to the current base (the fixture is stale).` });
            }
          }
        }
        if (materialize) {
          if (assembled === null) {
            console.log(`skip ${suiteLabel}: not an overlay suite (its cases run in place)`);
            continue;
          }
          for (const entry of assembled.values()) {
            if (entry.dir === null) continue;
            cpSync(entry.dir, join(materialize, suiteLabel, entry.name), { recursive: true, verbatimSymlinks: true });
            materialized += 1;
          }
          console.log(`ok   ${suiteLabel}: ${[...assembled.values()].filter((entry) => entry.dir !== null).length} cases -> ${toPosix(join(materialize, suiteLabel))}`);
          continue;
        }
        const argsMode = suite.argsFile ?? spec?.argsFile ?? 'error-only';
        const ran = [];
        for (const name of dirs.filter((dir) => selftestCaseKind(dir) !== null && only(dir))) {
          const kind = selftestCaseKind(name);
          const source = join(fixtures, name);
          const entry = assembled?.get(name);
          if (entry && entry.dir === null) continue;
          if (!entry && !existsSync(source)) {
            report.problem({ file: toPosix(relative(here, join(fixtures, CASES_FILE))), rule: 'selftest-assemble', message: `${label} ${name}: lives only in ${CASES_FILE}, but the suite is not assembled (no ${SUITE_FILE} or base)`, fix: `Add ${SUITE_FILE} with the base the cases are built from, or give the case its own folder.` });
            continue;
          }
          const dir = entry ? entry.dir : source;
          const inlineExpect = entry?.expect ?? null;
          const expectPath = inlineExpect !== null ? join(fixtures, CASES_FILE) : join(source, 'EXPECT.txt');
          const expectText = inlineExpect ?? (hasEntry(source, 'EXPECT.txt') ? readFileSync(expectPath, 'utf8') : null);
          const expected = expectText !== null ? expectText.split('\n').map((line) => line.trim()).filter(Boolean) : kind === 'good' ? [] : null;
          if (expected === null || (kind !== 'good' && expected.length === 0)) {
            report.problem({ file: toPosix(relative(here, expectPath)), rule: 'selftest-expect', message: `${name} has no EXPECT.txt or CASES.json "expect" (or it is empty)`, fix: kind === 'pass-' ? 'Write the lines a passing run must print (a SKIP line, a note), one per line.' : kind === 'error-' ? 'Write the ERROR text the checker must print for this input, one per line.' : 'Write the rule id or message the checker must print, one per line.' });
            continue;
          }
          // ARGS.txt: its words replace (or follow) args(dir); before overlay suites only error-* cases used it.
          const argsText = hasEntry(source, 'ARGS.txt') ? readFileSync(join(source, 'ARGS.txt'), 'utf8') : (entry?.args ?? null);
          const argsTxt = argsText !== null ? argsText.trim().split(/\s+/).filter(Boolean).map((word) => word.replaceAll('{dir}', dir)) : null;
          const context = { name, kind, source, suiteDir: fixtures, argsTxt };
          let argv;
          if (argsTxt !== null && (argsMode === 'replace' || (argsMode === 'error-only' && kind === 'error-'))) argv = argsTxt;
          else if (argsTxt !== null && argsMode === 'append') argv = [...args(dir, context), ...argsTxt];
          else argv = args(dir, context);
          ran.push({ name, kind, dir, source, expected, result: runNode(script, argv, dir, timeoutMs) });
          runs += 1;
        }
        // Every case that should run stopped with the same exit-2 error: the environment is not
        // ready (for example a package is not installed). Say that once instead of failing every case.
        // error-* cases stop with exit 2 on purpose, so they never count here.
        const runnable = ran.filter(({ kind }) => kind !== 'error-');
        const errors = runnable.map(({ result }) => (result.status === 2 ? /^ERROR \[[^\]]+\] (.*)$/m.exec(result.stdout)?.[1] : null));
        if (runnable.length > 0 && errors.every((error) => error && error === errors[0])) {
          const [message, fix = 'Fix the environment, then rerun.'] = errors[0].split(' Fix: ');
          throw new UsageError(`${label} cannot run here, every fixture stopped with: ${message}`, fix);
        }
        for (const { name, kind, source, expected, result } of ran) {
          const shown = `${label} ${name}`;
          const want = SELFTEST_CASES[kind].exit;
          const final = lastLine(result.stdout);
          const problems = [];
          if (result.timedOut) problems.push(`timed out after ${timeoutMs} ms`);
          if (result.status !== want) problems.push(`expected exit ${want}, got ${result.status}`);
          if (!RESULT_PATTERN.test(final)) problems.push(`last line is not a RESULT line: "${final}"`);
          else if (want === 0 && final !== 'RESULT: PASS') problems.push(`expected RESULT: PASS, got "${final}"`);
          for (const text of expected) if (!result.output.includes(text)) problems.push(`output does not contain "${text}"`);
          if (problems.length > 0) {
            const fix = {
              good: 'Fix the checker (or the good fixture) so clean input passes.',
              'pass-': 'Fix the checker so this passing case exits 0 and prints what EXPECT.txt says.',
              'bad-': 'Fix the checker so it catches the planted bug and names it as EXPECT.txt says.',
              'error-': 'Fix the checker so this input stops with exit 2 (fail() or UsageError) and prints what EXPECT.txt says; exit 1 is for problems found, exit 2 for bad input.',
            }[kind];
            report.problem({ file: toPosix(relative(here, source)), rule: 'selftest-case', message: `${shown}: ${problems.join('; ')}\n${tail(result.output)}`, fix });
          } else {
            console.log(`ok   ${shown} (exit ${result.status}${expected.length ? `, found ${expected.map((text) => `"${text}"`).join(', ')}` : ''})`);
          }
        }
      }
    } finally {
      if (work !== null) removeTempDir(work);
    }
    if (materialize) return report.finish({ checked: materialized + report.count, unit: 'cases' });
    return report.finish({ checked: runs, unit: 'runs' });
  });
}

// ---------------------------------------------------------------------------------------------
// Pinned packages of a skill that needs them (scripts/package.json)
// ---------------------------------------------------------------------------------------------

/** The environment variable that points a skill at its tooling folder: 'design-review' -> 'DESIGN_REVIEW_TOOLING_DIR'. */
export function toolingEnvVar(skill) {
  if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill)) throw new Error(`toolingEnvVar needs a skill name (lowercase letters, digits, hyphens), got ${JSON.stringify(skill)}`);
  return `${skill.toUpperCase().replaceAll('-', '_')}_TOOLING_DIR`;
}

/** The skill name of a scripts/ folder: the name of the folder that holds it. */
function skillOfScriptsDir(scriptsDir) {
  return basename(dirname(resolve(scriptsDir)));
}

/**
 * The folder that holds a skill's installed packages (its node_modules/): the --tooling option,
 * else the environment variable (envVar, or toolingEnvVar(skill) when only skill is given), else
 * the skill's own scripts/ folder. Use the option or the variable when the skill folder must stay
 * read-only or is shared by several sessions (plugin caches are wiped on update).
 *   const tooling = resolveToolingDir({ given: options.tooling, skill: 'design-visual-parity', scriptsDir: SCRIPTS_DIR });
 */
export function resolveToolingDir({ given, envVar, skill, scriptsDir } = {}) {
  const variable = envVar ?? (skill ? toolingEnvVar(skill) : undefined);
  const fromEnv = variable ? process.env[variable] : undefined;
  const dir = [given, fromEnv].find((value) => typeof value === 'string' && value.trim() !== '') ?? scriptsDir;
  if (typeof dir !== 'string' || dir.trim() === '') throw new Error('resolveToolingDir needs scriptsDir (the skill\'s scripts/ folder)');
  return resolve(dir);
}

/**
 * The fix text for a pinned package that is not installed. It gives both install forms: into the
 * skill's own scripts/ folder, and, when the skill folder must stay read-only or is shared, into a
 * folder in the app repo (default <repo>/.skill-tooling/<skill>, git-ignored) that the script is
 * then pointed at with --tooling <dir> (or the variable: envVar, or toolingEnvVar(skill) when skill
 * is given). The skill defaults to the name of the folder that holds scriptsDir.
 *   fail('pngjs 7.0.0 is not installed', packageInstallFix({ scriptsDir: SCRIPTS_DIR, skill: 'design-visual-parity' }));
 */
export function packageInstallFix({ scriptsDir, envVar, skill, option = '--tooling', repoDir } = {}) {
  if (typeof scriptsDir !== 'string' || scriptsDir.trim() === '') throw new Error('packageInstallFix needs scriptsDir (the skill\'s scripts/ folder)');
  const variable = envVar ?? (skill ? toolingEnvVar(skill) : undefined);
  const folder = repoDir ?? `.skill-tooling/${skill ?? skillOfScriptsDir(scriptsDir)}`;
  const pinned = `the pinned package.json and package-lock.json of ${scriptsDir}`;
  const pointAt = variable ? `pass ${option} <repo>/${folder} (or set ${variable}=<repo>/${folder})` : `pass ${option} <repo>/${folder}`;
  return `Install the pinned packages into the skill: npm ci --prefix "${scriptsDir}". When the skill folder must stay read-only or is shared by other sessions, copy ${pinned} into <repo>/${folder}, run npm ci --prefix <repo>/${folder}, and ${pointAt}.`;
}

/** The entry file of an installed package for import(): exports (node, import, default), then main. */
function packageEntry(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const pick = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(pick).find(Boolean) ?? null;
    if (value && typeof value === 'object') {
      if ('.' in value) return pick(value['.']);
      for (const condition of ['node', 'import', 'default', 'require']) if (condition in value) {
        const found = pick(value[condition]);
        if (found) return found;
      }
    }
    return null;
  };
  return (pkg.exports !== undefined ? pick(pkg.exports) : null) ?? pkg.main ?? 'index.js';
}

/**
 * Load a pinned package from a tooling folder (resolveToolingDir), or stop with exit 2 and the
 * install fix. Keeps --help and argument errors working before any install.
 *   const { PNG } = await importPackage('pngjs', tooling, { what: 'pngjs 7.0.0', fix: packageInstallFix({ ... }) });
 */
export async function importPackage(name, toolingDir, { what = name, fix } = {}) {
  const pkgDir = join(resolve(toolingDir), 'node_modules', ...name.split('/'));
  if (!existsSync(join(pkgDir, 'package.json'))) {
    throw new UsageError(`${what} is not installed in ${toPosix(resolve(toolingDir))}/node_modules`, fix ?? `Run: npm ci --prefix "${toolingDir}"`);
  }
  const entry = join(pkgDir, packageEntry(pkgDir));
  return import(pathToFileURL(entry).href);
}

/**
 * Make an empty temporary folder and return its real path (on macOS the temp folder is reached through
 * a symlink, /var -> /private/var; a checker that compares the root it was given with a path derived
 * from a loaded module would otherwise see two different paths). Remove it with removeTempDir().
 */
export function makeTempDir(prefix = 'check-lib-') {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}
