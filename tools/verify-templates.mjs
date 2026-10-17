#!/usr/bin/env node
// verify-templates.mjs: proves that a skill's templates compile, lint and pass their tests inside the
// reference Expo app (tools/harness) under the canonical root configs and canonical app files
// (tools/shared/repo-templates: root configs, __mocks__/, and the single-app trees src/ test/ scripts/ design/).
// A template that does not pass here does not ship (DECISIONS §8).
//
// How: clone the harness source without node_modules into a temp folder (APFS clone where the volume
// allows it), symlink node_modules back to an installed harness, overlay the canonical files,
// copy each template to the repo path its first line names (placeholders filled in), then run
// tsc --noEmit (both programs), ESLint --max-warnings 0 and Prettier on the copied files, and Jest on
// the tests related to them. Zero dependencies (node: built-ins only); the output follows the
// check-lib contract (FAIL <file>:<line> [<rule>] <message> Fix: <fix>, then RESULT).

import { spawnSync } from 'node:child_process';
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(TOOLS_DIR, '..');
const DEFAULT_HARNESS_SOURCE = join(TOOLS_DIR, 'harness');
const DEFAULT_REPO_TEMPLATES = join(TOOLS_DIR, 'shared', 'repo-templates');
const DEFAULT_SKILLS_ROOT = join(REPO_DIR, 'skills');
const HARNESS_ENV = 'RN_SKILLS_HARNESS';
const PLACEHOLDERS_FILE = 'assets/template-placeholders.json';

/** The canonical root configs: { from: path in repo-templates, to: path in the app }. __mocks__/* and CANONICAL_TREES are added at run time. */
export const CANONICAL_FILES = [
  ['eslint.config.mjs'], ['tsconfig.base.json'], ['tsconfig.json'], ['src/tsconfig.json'], ['src/app-env.d.ts'],
  ['tsconfig.stryker.json'], ['stryker.config.json'], ['jest.config.js'], ['jest.setup.ts'], ['jest.sim.config.js'],
  ['babel.config.js'], ['dot-prettierrc.json', '.prettierrc.json'], ['dot-prettierignore', '.prettierignore'], ['dot-gitignore', '.gitignore'],
  ['lefthook.yml'], ['quality-gates.json'], ['knip.json'], ['scripts/package.json'], ['scripts/quality/device-only.ts'],
  ['scripts/quality/device-only.test.ts'], ['test/goldens/skia-golden.ts'], ['dot-npmrc', '.npmrc'],
  ['dot-claude/settings.json', '.claude/settings.json'], ['contracts/contrast.json'], ['contracts/contrast.schema.json'],
  ['contracts/dependency-policy.json'], ['metro.config.js'],
].map(([from, to = from]) => ({ from, to }));
/**
 * The harness's manifest of adopted templates: { "<harness path>": "<skill>/templates/<path>" } or
 * { "<harness path>": { "template": "<skill>/templates/<path>", "adapted": "<why it differs>" } }, plus
 * "$scripts": { "<npm script>": "<skill and why>" } for harness scripts the canonical package-scripts.json lacks yet.
 * A copy that is not marked adapted must equal its template with the skill's placeholders filled in.
 */
export const ADOPTED_MANIFEST = 'adopted.json';
/**
 * The canonical single-app trees (DECISIONS §9 owners): every file under them in repo-templates is mirrored into the
 * harness at the same path. A path that holds a placeholder (__NAME__) is a template to be filled, not an app file,
 * and is left out.
 */
export const CANONICAL_TREES = ['src', 'test', 'scripts', 'design'];
/** True for a canonical tree path that is a placeholder template (never mirrored into the harness). */
export const isLegacyTemplatePath = (path) => /__([A-Z][A-Z0-9_]*[A-Z0-9])__/.test(path);
/**
 * knip.json in the harness may add these keys, in this order, each entry with its reason in the harness's
 * contracts/knip-ignores.json: ignoreDependencies (the pre-installed stack its tiny app does not import),
 * ignoreBinaries (system tools an adopted script starts) and ignoreIssues (never for app code: typescript-and-lint-rules forbids it).
 */
export const KNIP_HARNESS_KEYS = ['ignoreDependencies', 'ignoreBinaries', 'ignoreIssues'];
/** Top-level folders never copied from the harness source into the temp app. */
const CLONE_SKIP = new Set(['node_modules', '.expo', '.git', 'ios', 'android', 'build', 'dist', 'web-build', 'coverage', 'reports', '.stryker-tmp']);
/** Files never copied, at any depth. */
const TEMPLATE_SKIP = new Set(['.DS_Store']);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsonc']);
const HASH_EXTENSIONS = new Set(['.yaml', '.yml', '.sh', '.toml']);
const LINT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const PRETTIER_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.yaml', '.yml']);
const TEXT_EXTENSIONS = new Set([...CODE_EXTENSIONS, ...HASH_EXTENSIONS, ...PRETTIER_EXTENSIONS, '.txt', '.html', '.css', '.svg', '.xml', '.plist', '.gradle', '.kt', '.swift', '.m', '.h', '.properties', '.env', '.tmpl', '']);
/** __UPPER_SNAKE__ placeholders; React Native's __DEV__ is a real global, never a placeholder. */
const PLACEHOLDER = /__([A-Z][A-Z0-9_]*[A-Z0-9])__/g;
const NOT_PLACEHOLDERS = new Set(['__DEV__']);

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, BAD_INPUT: 2 });

const SPEC = {
  name: 'verify-templates',
  summary: 'Copies the templates of each named skill into a temp copy of the reference Expo app (tools/harness) at the repo path line 1 names, with the canonical files from tools/shared/repo-templates (root configs, __mocks__/, src/ test/ scripts/ design/) laid over it, then runs tsc --noEmit, ESLint --max-warnings 0, Prettier and the related Jest tests. Also fails when the committed harness copies of the canonical files drift from tools/shared/repo-templates, or an adopted template copy (tools/harness/adopted.json) drifts from its skill template.',
  usage: '[skill...] [options]',
  options: {
    harness: { type: 'string', value: 'dir', help: `An installed harness (a folder with node_modules); default: tools/harness when installed, else $${HARNESS_ENV}` },
    only: { type: 'string', multiple: true, value: 'glob', help: 'Check only templates whose path under templates/ matches the glob' },
    keep: { type: 'boolean', help: 'Keep the temp app and print its path (inspect or rerun a tool there)' },
    'no-jest': { type: 'boolean', help: 'Skip Jest' },
    'no-lint': { type: 'boolean', help: 'Skip ESLint' },
    'no-prettier': { type: 'boolean', help: 'Skip the Prettier check' },
    'sync-harness': { type: 'boolean', help: 'Copy the canonical files (root configs, __mocks__/, src/ test/ scripts/ design/) into tools/harness first (fixes harness-drift), and refresh every adopted template copy not marked adapted (fixes harness-adopted); no skill needed' },
    'skills-root': { type: 'string', value: 'dir', help: 'Folder that holds the skill folders (default: <repo>/skills)' },
    'harness-source': { type: 'string', value: 'dir', help: 'The harness app source to clone (default: tools/harness); for tests' },
    'repo-templates': { type: 'string', value: 'dir', help: 'The canonical repo-templates folder (default: tools/shared/repo-templates); for tests' },
  },
  positionals: { min: 0, max: Infinity },
  details: [
    'Skill arguments are skill names under the skills root or paths to skill folders. With no skill, only',
    'the harness-drift check runs (it needs no installed harness).',
    'Template placement (line 1 names the repo path):',
    '  .ts .tsx .js .mjs .cjs .d.ts .jsonc   // src/features/tasks/tasks-screen.tsx',
    '  .yaml .yml .sh .toml                  # .maestro/flows/smoke.yaml (line 2 after a #! line)',
    '  .json and every other file            the path under templates/ (a dot- prefix becomes ".")',
    '  An adapted harness copy (adopted.json) that holds every line of the template landing on it extends that',
    '  template and stays in place (a NOTE says so): the template\'s lines are compiled inside it.',
    '  A message catalog (a flat JSON object of strings) that lands on an existing app catalog adds its keys',
    '  to it (template values win, keys sorted) instead of replacing it: the app keeps its own messages.',
    `Placeholders: __UPPER_SNAKE__ names take their values from <skill>/${PLACEHOLDERS_FILE}`,
    '  ({ "__FEATURE__": "tasks" }); a name with no value gets a deterministic default (kebab case;',
    '  *_PASCAL -> PascalCase, *_CAMEL -> camelCase, *_CONST -> UPPER_SNAKE) and a WARN line.',
    'Rules: placement, tsc, eslint, prettier, jest, harness-drift, harness-adopted, harness-stale.',
    'Canonical files (drift check, --sync-harness, overlaid on every temp app): the root configs (with .npmrc,',
    '  .claude/settings.json and the canonical contracts), __mocks__/*, and every file under',
    `  ${CANONICAL_TREES.map((tree) => `${tree}/`).join(' ')} in repo-templates except placeholder paths (__NAME__).`,
    `Adopted templates (tools/harness/${ADOPTED_MANIFEST}): every harness copy of a skill template, keyed by harness path,`,
    '  must equal the template with the skill\'s placeholders filled in, unless the entry is marked "adapted" with',
    '  the reason; --sync-harness refreshes the copies that are not adapted. "$scripts" names the harness npm',
    '  scripts that package-scripts.json lacks yet (each with its skill and reason).',
    `Harness: --harness <dir>, else tools/harness when it has node_modules, else $${HARNESS_ENV}.`,
    '  Install one with: npm ci --prefix tools/harness',
    'A skill without templates is NOT APPLICABLE (exit 0).',
  ].join('\n'),
};

// ---------------------------------------------------------------------------------------------
// Output contract (copied from check-lib.mjs; this tool stays dependency-free and self-contained)
// ---------------------------------------------------------------------------------------------

class UsageError extends Error {
  constructor(message, fix = 'Run: node tools/verify-templates.mjs --help') {
    super(message);
    this.name = 'UsageError';
    this.fix = fix;
  }
}

function writeOut(text) {
  try {
    writeSync(1, text);
  } catch {
    process.stdout.write(text);
  }
}

function resultLine(count) {
  return count === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${count} problems)`;
}

function formatProblem({ file, line, rule, message, fix }) {
  const where = file ? `${file}${line ? `:${line}` : ''} ` : '';
  return `FAIL ${where}[${rule}] ${message}${fix ? ` Fix: ${fix}` : ''}`;
}

function helpText(spec) {
  const lines = [`Usage: node tools/${spec.name}.mjs ${spec.usage}`, '', spec.summary, ''];
  const rows = Object.entries(spec.options).map(([key, value]) => [`--${key}${value.type === 'boolean' ? '' : ` <${value.value ?? 'value'}>`}`, `${value.help}${value.multiple ? ' (repeatable)' : ''}`]);
  rows.push(['-h, --help', 'Show this help and exit']);
  const width = Math.max(...rows.map(([flag]) => flag.length));
  lines.push('Options:', ...rows.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`), '', spec.details, '');
  lines.push('Exit codes: 0 pass, 1 problems found, 2 bad input or environment.', 'The last line is always "RESULT: PASS" or "RESULT: FAIL (<n> problems)".');
  return lines.join('\n');
}

function parseArgs(argv, spec) {
  const optionSpec = { help: { type: 'boolean', short: 'h' } };
  for (const [key, value] of Object.entries(spec.options)) optionSpec[key] = { type: value.type, ...(value.multiple ? { multiple: true } : {}) };
  let parsed;
  try {
    parsed = nodeParseArgs({ args: argv, options: optionSpec, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message.split('\n')[0].replace(/\. To specify a positional argument starting with a '-'.*$/, ''));
  }
  if (parsed.values.help) {
    writeOut(`${helpText(spec)}\n`);
    process.exit(EXIT.PASS);
  }
  const options = {};
  for (const [key, value] of Object.entries(spec.options)) options[key] = parsed.values[key] ?? (value.multiple ? [] : value.type === 'boolean' ? false : undefined);
  return { options, positionals: parsed.positionals };
}

function createReporter(name) {
  const problems = [];
  return {
    get count() {
      return problems.length;
    },
    problem(entry) {
      problems.push({ file: entry.file ?? '', line: entry.line ?? 0, rule: entry.rule, message: entry.message, fix: entry.fix ?? '' });
    },
    note(text) {
      console.log(text);
    },
    notApplicable(reason) {
      console.log(`NOT APPLICABLE: ${reason}`);
      console.log(resultLine(0));
      return EXIT.PASS;
    },
    finish({ checked, unit }) {
      if (checked === 0 && problems.length === 0) throw new UsageError(`nothing to check: 0 ${unit} found`, 'Name a skill folder that has a templates/ folder, or pass --sync-harness.');
      for (const entry of problems) console.log(formatProblem(entry));
      console.log(`${name}: ${checked} ${unit} checked, ${problems.length} problems`);
      console.log(resultLine(problems.length));
      return problems.length === 0 ? EXIT.PASS : EXIT.FAIL;
    },
  };
}

async function run(main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof UsageError) console.log(`ERROR [bad-input] ${error.message} Fix: ${error.fix}`);
    else console.log(`ERROR [crash] ${error?.stack ?? error} Fix: this is a bug in verify-templates.mjs; fix it, then rerun.`);
    console.log(resultLine(1));
    process.exitCode = EXIT.BAD_INPUT;
  }
}

// ---------------------------------------------------------------------------------------------
// Files and globs
// ---------------------------------------------------------------------------------------------

const toPosix = (path) => path.split(sep).join('/');

/** Glob to RegExp: **, *, ?, {a,b} (the subset check-lib supports). */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      out += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else if (ch === '{') out += '(?:';
    else if (ch === '}') out += ')';
    else if (ch === ',') out += '|';
    else if ('\\^$.|+()[]'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`);
}

/** Every file under dir as a posix path relative to dir, sorted; skipTop names are skipped at the top level only. */
function listFiles(dir, skipTop = new Set()) {
  const out = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (TEMPLATE_SKIP.has(entry.name) || (current === dir && skipTop.has(entry.name))) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(toPosix(relative(dir, full)));
    }
  };
  visit(dir);
  return out;
}

/** Copy a file with an APFS clone where the volume allows it (a plain copy elsewhere). */
function cloneFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { mode: constants.COPYFILE_FICLONE, force: true });
}

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sameBytes = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));

// ---------------------------------------------------------------------------------------------
// The harness: where it is, and whether its canonical configs drifted
// ---------------------------------------------------------------------------------------------

const hasNodeModules = (dir) => isDir(join(dir, 'node_modules')) && existsSync(join(dir, 'node_modules', 'typescript', 'package.json'));

function resolveInstalledHarness(options, harnessSource) {
  const fix = `Install the harness once: npm ci --prefix ${toPosix(relative(process.cwd(), DEFAULT_HARNESS_SOURCE)) || 'tools/harness'} (or point --harness / $${HARNESS_ENV} at an installed copy).`;
  if (options.harness !== undefined) {
    const dir = resolve(options.harness);
    if (!hasNodeModules(dir)) throw new UsageError(`--harness ${dir} has no installed node_modules`, fix);
    return dir;
  }
  if (hasNodeModules(harnessSource)) return harnessSource;
  const fromEnv = process.env[HARNESS_ENV];
  if (fromEnv) {
    const dir = resolve(fromEnv);
    if (!hasNodeModules(dir)) throw new UsageError(`$${HARNESS_ENV}=${dir} has no installed node_modules`, fix);
    return dir;
  }
  throw new UsageError(`no installed harness: ${harnessSource} has no node_modules and $${HARNESS_ENV} is not set`, fix);
}

/** The canonical files: the root configs, every root mock in repo-templates/__mocks__/, and every file of CANONICAL_TREES. */
export function canonicalFiles(repoTemplates) {
  const mocksDir = join(repoTemplates, '__mocks__');
  const mocks = isDir(mocksDir) ? listFiles(mocksDir).map((file) => ({ from: `__mocks__/${file}`, to: `__mocks__/${file}` })) : [];
  const listed = new Set(CANONICAL_FILES.map(({ to }) => to));
  const trees = CANONICAL_TREES.flatMap((tree) => {
    const dir = join(repoTemplates, tree);
    return isDir(dir) ? listFiles(dir).map((file) => `${tree}/${file}`) : [];
  })
    .filter((path) => !listed.has(path) && !isLegacyTemplatePath(path))
    .map((path) => ({ from: path, to: path }));
  return [...CANONICAL_FILES, ...mocks, ...trees];
}

function knipWithoutHarnessKeys(path) {
  const knip = readJson(path);
  for (const key of KNIP_HARNESS_KEYS) delete knip[key];
  return JSON.stringify(knip);
}

/** The harness's own knip keys of a parsed knip.json, in KNIP_HARNESS_KEYS order. */
const harnessKnipKeys = (knip) => Object.fromEntries(KNIP_HARNESS_KEYS.filter((key) => knip[key] !== undefined).map((key) => [key, knip[key]]));

/** A JSON array member laid out the way Prettier prints it: one line when it fits in 100 columns, else one item per line. */
function knipArrayBlock(key, items, indent) {
  const oneLine = `${indent}${JSON.stringify(key)}: [${items.map((item) => JSON.stringify(item)).join(', ')}]`;
  return oneLine.length <= 100 ? oneLine : `${indent}${JSON.stringify(key)}: [\n${items.map((item) => `${indent}  ${JSON.stringify(item)}`).join(',\n')}\n${indent}]`;
}

/**
 * The harness knip.json: the canonical text verbatim, plus the harness's own keys (KNIP_HARNESS_KEYS) last,
 * laid out the way Prettier prints them. `harnessKeys` is { ignoreDependencies, ignoreBinaries, ignoreIssues }
 * (an array alone means ignoreDependencies).
 */
export function harnessKnipText(canonicalText, harnessKeys) {
  const keys = Array.isArray(harnessKeys) ? { ignoreDependencies: harnessKeys } : harnessKeys ?? {};
  const blocks = [];
  for (const key of KNIP_HARNESS_KEYS) {
    const value = keys[key];
    if (Array.isArray(value) && value.length > 0) blocks.push(knipArrayBlock(key, value, '  '));
    else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
      blocks.push(`  ${JSON.stringify(key)}: {\n${Object.entries(value).map(([glob, types]) => knipArrayBlock(glob, types, '    ')).join(',\n')}\n  }`);
    }
  }
  if (blocks.length === 0) return canonicalText;
  return canonicalText.replace(/\n}\s*$/, `,\n${blocks.join(',\n')}\n}\n`);
}

// ---------------------------------------------------------------------------------------------
// Adopted templates: harness copies of skill templates, listed in tools/harness/adopted.json
// ---------------------------------------------------------------------------------------------

const ADOPTED_SYNC_FIX = 'Run: node tools/verify-templates.mjs --sync-harness (it refreshes every adopted copy not marked adapted), then rerun the harness gates; or mark the entry {"template": ..., "adapted": "<why it differs>"} when the harness changes it on purpose.';

/**
 * The adopted-template manifest of a harness: { entries: [{ path, template, adapted }], scripts: { name: reason } }
 * and the shape problems it holds (each { message, fix }). A harness without the file adopted nothing.
 */
export function readAdoptedManifest(harnessSource) {
  const path = join(harnessSource, ADOPTED_MANIFEST);
  const empty = { entries: [], scripts: {}, problems: [] };
  if (!existsSync(path)) return empty;
  let data;
  try {
    data = readJson(path);
  } catch (error) {
    return { ...empty, problems: [{ message: `is not valid JSON: ${error.message}`, fix: 'Write one JSON object: { "<harness path>": "<skill>/templates/<path>" }.' }] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ...empty, problems: [{ message: 'must be a JSON object', fix: 'Write one JSON object: { "<harness path>": "<skill>/templates/<path>" }.' }] };
  const entries = [];
  const problems = [];
  const scripts = {};
  const shapeFix = 'Each entry is "<skill>/templates/<path>" or { "template": "<skill>/templates/<path>", "adapted": "<why the harness copy differs>" }.';
  for (const [key, value] of Object.entries(data)) {
    if (key === '$scripts') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) problems.push({ message: '"$scripts" must map npm script names to their skill and reason', fix: '"$scripts": { "build:ios:sim": "ios-simulator-build: <why it is not canonical yet>" }' });
      else for (const [name, reason] of Object.entries(value)) {
        if (typeof reason === 'string' && reason.trim().length >= 10) scripts[name] = reason;
        else problems.push({ message: `"$scripts"."${name}" needs its skill and reason (at least 10 characters)`, fix: '"$scripts": { "build:ios:sim": "ios-simulator-build: <why it is not canonical yet>" }' });
      }
      continue;
    }
    if (key.startsWith('$')) continue;
    const entry = typeof value === 'string' ? { template: value } : value;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || typeof entry.template !== 'string' || Object.keys(entry).some((name) => name !== 'template' && name !== 'adapted')) {
      problems.push({ message: `entry "${key}" has the wrong shape`, fix: shapeFix });
      continue;
    }
    if (entry.adapted !== undefined && (typeof entry.adapted !== 'string' || entry.adapted.trim().length < 10)) {
      problems.push({ message: `entry "${key}": "adapted" must say why the harness copy differs (at least 10 characters)`, fix: shapeFix });
      continue;
    }
    const match = /^([a-z0-9][a-z0-9-]*)\/templates\/(.+)$/.exec(entry.template);
    if (!match || isAbsolute(key) || key.split('/').includes('..')) {
      problems.push({ message: `entry "${key}": "${entry.template}" is not <skill>/templates/<path>, or the key leaves the harness`, fix: shapeFix });
      continue;
    }
    entries.push({ path: key, template: entry.template, skill: match[1], rel: match[2], adapted: entry.adapted ?? null });
  }
  return { entries, scripts, problems };
}

const isTextTemplate = (rel) => TEXT_EXTENSIONS.has(extname(rel)) || rel.endsWith('.d.ts');

/** What an adopted copy must hold: the template's bytes, placeholders filled from the skill's values; or { error }. */
function adoptedContent(skillsRoot, entry, placeholderCache) {
  const skillDir = join(skillsRoot, entry.skill);
  const source = join(skillDir, 'templates', ...entry.rel.split('/'));
  if (!existsSync(source)) return { error: `its template ${entry.template} no longer exists`, fix: 'Point the entry at the template\'s new path (and refresh the copy), or delete the harness copy and its entry when the skill dropped the template.' };
  if (!placeholderCache.has(entry.skill)) placeholderCache.set(entry.skill, readPlaceholders(skillDir));
  const values = placeholderCache.get(entry.skill);
  if (!isTextTemplate(entry.rel)) return { bytes: readFileSync(source), placed: placementOf(entry.rel, '', values) };
  const raw = readFileSync(source, 'utf8');
  return { bytes: Buffer.from(fillPlaceholders(raw, values).text), placed: placementOf(entry.rel, raw, values) };
}

function checkAdopted(repoTemplates, harnessSource, skillsRoot, report, label) {
  const manifest = readAdoptedManifest(harnessSource);
  const manifestLabel = label(ADOPTED_MANIFEST);
  for (const { message, fix } of manifest.problems) report.problem({ file: manifestLabel, rule: 'harness-adopted', message, fix });
  const canonical = new Set(canonicalFiles(repoTemplates).map(({ to }) => to));
  const cache = new Map();
  for (const entry of manifest.entries) {
    if (canonical.has(entry.path)) {
      report.problem({ file: manifestLabel, rule: 'harness-adopted', message: `"${entry.path}" is a canonical file (drift-checked against repo-templates), not an adopted template`, fix: `Delete the entry from ${ADOPTED_MANIFEST}.` });
      continue;
    }
    const want = adoptedContent(skillsRoot, entry, cache);
    if (want.error) {
      report.problem({ file: manifestLabel, rule: 'harness-adopted', message: `"${entry.path}": ${want.error}`, fix: want.fix });
      continue;
    }
    if (want.placed.error || want.placed.path !== entry.path) {
      report.problem({ file: manifestLabel, rule: 'harness-adopted', message: `"${entry.path}": ${entry.template} lands at ${want.placed.path ?? `no path (${want.placed.error})`}, not at the key`, fix: 'Key the entry by the repo path the template names (line 1, or its path under templates/).' });
      continue;
    }
    const target = join(harnessSource, entry.path);
    if (!existsSync(target)) {
      report.problem({ file: label(entry.path), rule: 'harness-adopted', message: `missing adopted copy of ${entry.template}`, fix: entry.adapted ? `Restore the adapted copy, or delete its entry from ${ADOPTED_MANIFEST}.` : ADOPTED_SYNC_FIX });
      continue;
    }
    const same = readFileSync(target).equals(want.bytes);
    if (!same && entry.adapted === null) report.problem({ file: label(entry.path), rule: 'harness-adopted', message: `differs from its skill template ${entry.template} (stale adopted copy)`, fix: ADOPTED_SYNC_FIX });
    if (same && entry.adapted !== null) report.problem({ file: manifestLabel, rule: 'harness-adopted', message: `"${entry.path}" is marked adapted ("${entry.adapted.slice(0, 60)}") but equals ${entry.template}`, fix: 'Drop "adapted" (the plain "<skill>/templates/<path>" form), so the drift check guards the copy again.' });
  }
  return manifest;
}

/** Refresh every adopted copy that is not marked adapted and whose template still lands at its key. */
function syncAdopted(harnessSource, skillsRoot, report) {
  const cache = new Map();
  for (const entry of readAdoptedManifest(harnessSource).entries) {
    if (entry.adapted !== null) continue;
    const want = adoptedContent(skillsRoot, entry, cache);
    if (want.error || want.placed.error || want.placed.path !== entry.path) continue;
    const target = join(harnessSource, entry.path);
    if (existsSync(target) && readFileSync(target).equals(want.bytes)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, want.bytes);
    report.note(`sync  ${toPosix(relative(process.cwd(), target))} (adopted from ${entry.template})`);
  }
}

/** Copy the canonical configs into the harness source; knip.json keeps the harness's own keys (KNIP_HARNESS_KEYS). */
function syncHarness(repoTemplates, harnessSource, report) {
  for (const { from, to } of canonicalFiles(repoTemplates)) {
    const source = join(repoTemplates, from);
    const target = join(harnessSource, to);
    if (!existsSync(source)) continue;
    if (to === 'knip.json' && existsSync(target)) {
      const text = harnessKnipText(readFileSync(source, 'utf8'), harnessKnipKeys(readJson(target)));
      if (readFileSync(target, 'utf8') !== text) {
        writeFileSync(target, text);
        report.note(`sync  ${toPosix(relative(process.cwd(), target))}`);
      }
      continue;
    }
    if (!sameBytes(source, target)) {
      cloneFile(source, target);
      report.note(`sync  ${toPosix(relative(process.cwd(), target))}`);
    }
  }
}

function checkDrift(repoTemplates, harnessSource, skillsRoot, report) {
  const label = (path) => toPosix(relative(process.cwd(), join(harnessSource, path)));
  const syncFix = 'Run: node tools/verify-templates.mjs --sync-harness (never edit the harness copy by hand; change tools/shared/repo-templates).';
  let checked = 0;
  for (const { from, to } of canonicalFiles(repoTemplates)) {
    const source = join(repoTemplates, from);
    const target = join(harnessSource, to);
    if (!existsSync(source)) {
      report.problem({ file: toPosix(relative(process.cwd(), source)), rule: 'harness-drift', message: 'canonical file is missing from repo-templates', fix: 'Restore it in tools/shared/repo-templates (the harness tests what it holds).' });
      continue;
    }
    checked += 1;
    if (!existsSync(target)) {
      report.problem({ file: label(to), rule: 'harness-drift', message: `missing harness copy of the canonical ${from}`, fix: syncFix });
    } else if (to === 'knip.json' ? knipWithoutHarnessKeys(source) !== knipWithoutHarnessKeys(target) : !sameBytes(source, target)) {
      report.problem({ file: label(to), rule: 'harness-drift', message: `differs from the canonical tools/shared/repo-templates/${from}`, fix: syncFix });
    }
  }
  const adopted = checkAdopted(repoTemplates, harnessSource, skillsRoot, report, label);
  checked += adopted.entries.length;
  checked += checkPackageDrift(repoTemplates, harnessSource, report, label, adopted.scripts);
  return checked;
}

/**
 * The canonical package.json pins and scripts must be what the harness installs and runs. A harness script
 * package-scripts.json lacks is allowed only when adopted.json "$scripts" names it with its skill and reason.
 */
function checkPackageDrift(repoTemplates, harnessSource, report, label, adoptedScripts = {}) {
  const canonicalPath = join(repoTemplates, 'package.json');
  const scriptsPath = join(repoTemplates, 'package-scripts.json');
  const harnessPath = join(harnessSource, 'package.json');
  if (!existsSync(canonicalPath) || !existsSync(harnessPath)) return 0;
  const canonical = readJson(canonicalPath);
  const harness = readJson(harnessPath);
  const fix = 'Make tools/harness/package.json match tools/shared/repo-templates/package.json, then run: npm install --prefix tools/harness (it rewrites the lockfile).';
  for (const key of ['devDependencies', 'overrides', 'engines']) {
    for (const [name, want] of Object.entries(canonical[key] ?? {})) {
      const got = harness[key]?.[name];
      if (got !== want) report.problem({ file: label('package.json'), rule: 'harness-drift', message: `${key}.${name} is ${JSON.stringify(got)}, canonical ${JSON.stringify(want)}`, fix });
    }
  }
  const scripts = existsSync(scriptsPath) ? readJson(scriptsPath) : canonical.scripts ?? {};
  if (existsSync(scriptsPath) && JSON.stringify(canonical.scripts ?? {}) !== JSON.stringify(scripts)) {
    report.problem({ file: toPosix(relative(process.cwd(), canonicalPath)), rule: 'harness-drift', message: 'package.json scripts differ from package-scripts.json', fix: 'Keep repo-templates/package.json "scripts" identical to package-scripts.json.' });
  }
  for (const [name, command] of Object.entries(harness.scripts ?? {})) {
    if (scripts[name] === undefined && adoptedScripts[name] !== undefined) continue;
    if (scripts[name] !== command) report.problem({ file: label('package.json'), rule: 'harness-drift', message: `script "${name}" is not the canonical ${JSON.stringify(scripts[name] ?? null)}`, fix: `Harness scripts are a subset of package-scripts.json, with the same commands (a script the canonical list lacks yet goes into ${ADOPTED_MANIFEST} "$scripts" with its skill and reason).` });
  }
  for (const name of Object.keys(adoptedScripts)) {
    if (scripts[name] !== undefined) report.problem({ file: label(ADOPTED_MANIFEST), rule: 'harness-adopted', message: `"$scripts"."${name}" is canonical now (package-scripts.json has it)`, fix: `Delete it from "$scripts"; the harness command must equal ${JSON.stringify(scripts[name])}.` });
    else if (harness.scripts?.[name] === undefined) report.problem({ file: label(ADOPTED_MANIFEST), rule: 'harness-adopted', message: `"$scripts"."${name}" names a script tools/harness/package.json does not have`, fix: 'Delete the stale entry, or add the script.' });
  }
  return 1;
}

function checkStale(installed, harnessSource, report) {
  if (installed === harnessSource) return;
  const want = join(harnessSource, 'package-lock.json');
  const got = join(installed, 'package-lock.json');
  if (existsSync(want) && !sameBytes(want, got)) {
    report.problem({ file: toPosix(relative(process.cwd(), got)), rule: 'harness-stale', message: `the installed harness was installed from a different package-lock.json than ${toPosix(relative(process.cwd(), want))}`, fix: `Copy package.json and package-lock.json from tools/harness into ${installed}, then run: npm ci --prefix ${installed}` });
  }
}

// ---------------------------------------------------------------------------------------------
// Templates: placement and placeholders
// ---------------------------------------------------------------------------------------------

function resolveSkill(arg, skillsRoot) {
  const byName = join(skillsRoot, arg);
  if (!arg.includes('/') && !arg.includes(sep) && isDir(byName)) return { name: arg, dir: byName };
  const byPath = resolve(arg);
  if (isDir(byPath)) return { name: basename(byPath), dir: byPath };
  throw new UsageError(`no skill folder named ${arg} (looked in ${skillsRoot} and at ${byPath})`, 'Pass a skill name under skills/ or a path to a skill folder.');
}

function words(name) {
  return name.toLowerCase().split('_').filter(Boolean);
}

/** The deterministic default for a placeholder without a value (see --help). */
export function defaultValue(name) {
  const parts = words(name);
  const last = parts.at(-1);
  const rest = parts.length > 1 ? parts.slice(0, -1) : parts;
  const pascal = rest.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  if (last === 'pascal') return pascal;
  if (last === 'camel') return pascal[0].toLowerCase() + pascal.slice(1);
  if (last === 'const' || last === 'upper' || last === 'snake') return rest.join('_').toUpperCase();
  return parts.join('-');
}

function readPlaceholders(skillDir) {
  const path = join(skillDir, PLACEHOLDERS_FILE);
  if (!existsSync(path)) return {};
  let data;
  try {
    data = readJson(path);
  } catch (error) {
    throw new UsageError(`${path} is not valid JSON: ${error.message}`, 'Write a JSON object: { "__FEATURE__": "tasks" }.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new UsageError(`${path} must be a JSON object`, 'Write a JSON object: { "__FEATURE__": "tasks" }.');
  const values = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('$')) continue;
    if (typeof value !== 'string') throw new UsageError(`${path}: ${key} must be a string`, 'Every placeholder value is a string.');
    values[key.replace(/^__|__$/g, '')] = value;
  }
  return values;
}

/** Replace every __PLACEHOLDER__; returns the text and the names that used a default value. */
export function fillPlaceholders(text, values) {
  const defaulted = new Set();
  const filled = text.replace(PLACEHOLDER, (match, name) => {
    if (NOT_PLACEHOLDERS.has(match)) return match;
    if (values[name] !== undefined) return values[name];
    defaulted.add(name);
    return defaultValue(name);
  });
  return { text: filled, defaulted: [...defaulted], changed: filled !== text };
}

/**
 * Whether an adapted harness copy extends a template: every non-blank line of the template (trimmed)
 * occurs in the copy, so the copy is the template plus lines of its own.
 */
export function extendsTemplate(harnessText, templateText) {
  const have = new Set(harnessText.split('\n').map((line) => line.trim()));
  return templateText.split('\n').map((line) => line.trim()).filter((line) => line !== '').every((line) => have.has(line));
}

/** A JSON text whose value is a non-empty flat object of strings (a message catalog), or null. */
function flatStringMap(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([, entry]) => typeof entry === 'string') ? value : null;
}

/**
 * A template message catalog (a flat JSON object of strings) adds its keys to the app's catalog at the same path
 * instead of replacing it: an app merges a skill's messages into its own catalogs, so harness keys the template does
 * not know stay (template values win, keys sorted). Returns the merged text, or null when either side is not a catalog.
 */
export function mergeCatalogText(appText, templateText) {
  const app = flatStringMap(appText);
  const template = flatStringMap(templateText);
  if (app === null || template === null) return null;
  const merged = { ...app, ...template };
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((key) => [key, merged[key]]));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The repo path a template names, or { error } when it names none (see --help). */
export function placementOf(rel, text, values) {
  const name = basename(rel);
  const ext = name.endsWith('.d.ts') ? '.ts' : extname(name);
  const lines = text.split('\n');
  let declared = null;
  if (CODE_EXTENSIONS.has(ext)) {
    const match = /^\/\/\s*(\S+)/.exec(lines[0] ?? '');
    if (!match) return { error: `line 1 must name the repo path as "// <path>", found ${JSON.stringify((lines[0] ?? '').slice(0, 60))}`, fix: `Start the file with its repo path, e.g. // src/features/tasks/${name}` };
    declared = match[1].replace(/[:;,]+$/, '');
  } else if (HASH_EXTENSIONS.has(ext)) {
    const line = (lines[0] ?? '').startsWith('#!') ? lines[1] ?? '' : lines[0] ?? '';
    const match = /^#\s*(\S+)/.exec(line);
    if (!match) return { error: `the first line must name the repo path as "# <path>", found ${JSON.stringify(line.slice(0, 60))}`, fix: `Start the file with its repo path, e.g. # .maestro/flows/${name}` };
    declared = match[1].replace(/[:;,]+$/, '');
  }
  if (declared === null) {
    const parts = rel.split('/');
    parts[parts.length - 1] = name.startsWith('dot-') ? `.${name.slice(4)}` : name;
    return { path: fillPlaceholders(parts.join('/'), values).text };
  }
  const path = fillPlaceholders(declared, values).text.replace(/^\.\//, '');
  if (isAbsolute(path) || path.split('/').includes('..')) return { error: `line 1 names ${declared}, which leaves the repo (absolute or ..)`, fix: 'Name a path relative to the repo root, e.g. src/features/tasks/tasks-screen.tsx.' };
  if (path.split('/')[0] === 'node_modules') return { error: `line 1 names ${declared}, inside node_modules`, fix: 'Templates are app files; name a path outside node_modules.' };
  const declaredExt = path.endsWith('.d.ts') ? '.ts' : extname(path);
  if (declaredExt !== ext) return { error: `line 1 names ${declared}, but the template is a ${ext || 'extensionless'} file`, fix: 'Make the template file extension match the repo path it names.' };
  return { path };
}

// ---------------------------------------------------------------------------------------------
// Running the tools inside the temp app
// ---------------------------------------------------------------------------------------------

function tool(app, bin, args) {
  const result = spawnSync(process.execPath, [join(app, 'node_modules', ...bin.split('/')), ...args], { cwd: app, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', FORCE_COLOR: '0' } });
  if (result.error) throw new UsageError(`could not run ${bin}: ${result.error.message}`, 'Reinstall the harness: npm ci --prefix tools/harness');
  return result;
}

/** Problems in a harness file (not a template) were caused by a copied template: the harness alone is green. */
const blameOf = (label) => (label.startsWith('harness/') ? ' (harness file: a copied template broke it)' : '');

const firstLines = (text, count = 3) => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, count).join(' | ');

function runTsc(app, labelOf, report) {
  const fix = 'Make the template type-check under the canonical tsconfig set (strict flags, no Node types in src/); rerun with --keep and run npx tsc --noEmit -p src/tsconfig.json in the kept app.';
  for (const project of ['tsconfig.json', 'src/tsconfig.json']) {
    if (!existsSync(join(app, project))) continue;
    const result = tool(app, 'typescript/bin/tsc', ['--noEmit', '-p', project, '--pretty', 'false', '--incremental', 'false']);
    if (result.status === 0) continue;
    const seen = new Set();
    let reported = 0;
    for (const line of `${result.stdout}`.split('\n')) {
      const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
      const global = /^error (TS\d+): (.*)$/.exec(line);
      if (!match && !global) continue;
      const key = match ? `${match[1]}:${match[2]}:${match[4]}` : line;
      if (seen.has(key)) continue;
      seen.add(key);
      reported += 1;
      if (global) report.problem({ file: labelOf(''), rule: 'tsc', message: `${project}: ${global[1]} ${global[2]}`, fix });
      else report.problem({ file: labelOf(toPosix(match[1])), line: Number(match[2]), rule: 'tsc', message: `${toPosix(match[1])}: ${match[4]} ${match[5]}${blameOf(labelOf(toPosix(match[1])))}`, fix });
    }
    if (reported === 0) report.problem({ file: labelOf(''), rule: 'tsc', message: `tsc -p ${project} failed: ${firstLines(`${result.stdout}\n${result.stderr}`)}`, fix });
  }
}

function runEslint(app, files, labelOf, report) {
  const lintable = files.filter((file) => LINT_EXTENSIONS.has(extname(file)));
  if (lintable.length === 0) return;
  const result = tool(app, 'eslint/bin/eslint.js', ['--max-warnings', '0', '--no-warn-ignored', '--format', 'json', ...lintable]);
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    report.problem({ file: labelOf(''), rule: 'eslint', message: `ESLint did not run: ${firstLines(`${result.stderr}\n${result.stdout}`)}`, fix: 'Rerun with --keep and run npx eslint <file> in the kept app to see the error.' });
    return;
  }
  for (const entry of data) {
    const repoPath = toPosix(relative(app, entry.filePath));
    for (const message of entry.messages) {
      const rule = message.ruleId ?? (message.fatal ? 'parse-error' : 'eslint-core');
      report.problem({ file: labelOf(repoPath), line: message.line ?? 0, rule: 'eslint', message: `${repoPath}: ${rule} ${message.message.split('\n')[0]}`, fix: 'Follow the rule (exceptions live only in eslint.config.mjs; inline disables have no effect).' });
    }
  }
}

function runPrettier(app, files, labelOf, report) {
  const checkable = files.filter((file) => PRETTIER_EXTENSIONS.has(extname(file)));
  if (checkable.length === 0) return;
  const result = tool(app, 'prettier/bin/prettier.cjs', ['--list-different', ...checkable]);
  if (result.status === 0) return;
  const listed = `${result.stdout}`.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const repoPath of listed) report.problem({ file: labelOf(repoPath), rule: 'prettier', message: `${repoPath}: not formatted with the canonical .prettierrc.json`, fix: 'Run npx prettier --write on the template (printWidth 100, single quotes, trailing commas).' });
  if (listed.length === 0) report.problem({ file: labelOf(''), rule: 'prettier', message: `Prettier failed: ${firstLines(`${result.stderr}\n${result.stdout}`)}`, fix: 'Fix the syntax error Prettier reports.' });
}

function runJest(app, args, labelOf, report, cacheDir) {
  const out = join(app, '.verify-templates-jest.json');
  const result = tool(app, 'jest/bin/jest.js', ['--ci', '--json', '--outputFile', out, '--passWithNoTests', '--cacheDirectory', cacheDir, ...args]);
  if (!existsSync(out)) {
    report.problem({ file: labelOf(''), rule: 'jest', message: `Jest did not run: ${firstLines(`${result.stderr}\n${result.stdout}`)}`, fix: 'Rerun with --keep and run npx jest in the kept app to see the error.' });
    return 0;
  }
  const data = readJson(out);
  rmSync(out, { force: true });
  for (const suite of data.testResults ?? []) {
    if (suite.status !== 'failed') continue;
    const repoPath = toPosix(relative(app, suite.name));
    const failed = (suite.assertionResults ?? []).filter((test) => test.status === 'failed');
    const fix = 'Make the test pass against the harness (Jest 29 + jest-expo + RNTL 14); never weaken the assertion.';
    const blame = blameOf(labelOf(repoPath));
    if (failed.length === 0) report.problem({ file: labelOf(repoPath), rule: 'jest', message: `${repoPath}: test suite failed to run: ${firstLines(suite.message ?? '', 2)}${blame}`, fix });
    for (const test of failed) report.problem({ file: labelOf(repoPath), rule: 'jest', message: `${repoPath}: "${test.fullName ?? test.title}" failed: ${firstLines((test.failureMessages ?? []).join('\n'), 2)}${blame}`, fix });
  }
  return data.numTotalTests ?? 0;
}

// ---------------------------------------------------------------------------------------------
// One skill
// ---------------------------------------------------------------------------------------------

function cloneHarness(harnessSource, installed, repoTemplates, label) {
  // realpath: on macOS tmpdir() is under the /var symlink, and tools report /private/var paths.
  const app = realpathSync(mkdtempSync(join(tmpdir(), `verify-templates-${label}-`)));
  for (const file of listFiles(harnessSource, CLONE_SKIP)) cloneFile(join(harnessSource, file), join(app, file));
  symlinkSync(join(installed, 'node_modules'), join(app, 'node_modules'), 'dir');
  for (const { from, to } of canonicalFiles(repoTemplates)) {
    if (to === 'knip.json' || !existsSync(join(repoTemplates, from))) continue;
    cloneFile(join(repoTemplates, from), join(app, to));
  }
  return app;
}

function verifySkill(skill, context, report) {
  const templatesDir = join(skill.dir, 'templates');
  const only = context.options.only.map(globToRegExp);
  if (!isDir(templatesDir) || listFiles(templatesDir).length === 0) return { checked: 0, applicable: false, reason: `${skill.name} has no templates/ folder` };
  const templates = listFiles(templatesDir).filter((rel) => only.length === 0 || only.some((re) => re.test(rel)));
  if (templates.length === 0) throw new UsageError(`no template of ${skill.name} matches --only ${context.options.only.join(' ')}`, 'Match paths under templates/, e.g. --only "src/**/*.ts".');
  const values = readPlaceholders(skill.dir);
  const app = cloneHarness(context.harnessSource, context.installed, context.repoTemplates, skill.name);
  const templateOf = new Map();
  const copied = [];
  const unchanged = [];
  const tplLabel = (rel) => `${skill.name}/templates/${rel}`;
  // Harness copies adapted on purpose from one of these templates, by harness path.
  const adaptedFrom = new Map(readAdoptedManifest(context.harnessSource).entries.filter((entry) => entry.adapted !== null && entry.skill === skill.name).map((entry) => [entry.path, entry.rel]));
  for (const rel of templates) {
    const source = join(templatesDir, rel);
    const isText = TEXT_EXTENSIONS.has(extname(rel)) || rel.endsWith('.d.ts');
    const raw = isText ? readFileSync(source, 'utf8') : '';
    const placed = placementOf(rel, raw, values);
    if (placed.error) {
      report.problem({ file: tplLabel(rel), line: 1, rule: 'placement', message: placed.error, fix: placed.fix });
      continue;
    }
    if (templateOf.has(placed.path)) {
      report.problem({ file: tplLabel(rel), line: 1, rule: 'placement', message: `names ${placed.path}, which ${templateOf.get(placed.path)} names too`, fix: 'Give every template its own repo path.' });
      continue;
    }
    templateOf.set(placed.path, tplLabel(rel));
    const target = join(app, placed.path);
    mkdirSync(dirname(target), { recursive: true });
    if (isText) {
      const filled = fillPlaceholders(raw, values);
      for (const name of filled.defaulted) report.note(`WARN ${tplLabel(rel)} placeholder __${name}__ has no value in ${PLACEHOLDERS_FILE}; used "${defaultValue(name)}"`);
      // An adapted harness copy that holds every line of this template extends it (the harness's test-only
      // entry adds the members other skills export): it stays, so the harness code that reads the extra
      // members still compiles, and every template line is compiled inside it.
      const harnessText = adaptedFrom.get(placed.path) === rel && existsSync(target) ? readFileSync(target, 'utf8') : null;
      if (harnessText !== null && extendsTemplate(harnessText, filled.text)) {
        report.note(`verify-templates: ${skill.name}: kept the harness's adapted ${placed.path}: it holds every line of ${tplLabel(rel)} and extends it`);
        copied.push(placed.path);
        continue;
      }
      const merged = extname(placed.path) === '.json' && existsSync(target) ? mergeCatalogText(readFileSync(target, 'utf8'), filled.text) : null;
      writeFileSync(target, merged ?? filled.text);
      if (!filled.changed && merged === null) unchanged.push(placed.path);
    } else {
      cloneFile(source, target);
    }
    copied.push(placed.path);
  }
  report.note(`verify-templates: ${skill.name}: ${copied.length} of ${templates.length} templates copied into ${context.options.keep ? app : 'a temp copy of the harness'}`);
  // A problem in a file no template wrote is in the harness: a copied template broke it (the harness alone is green).
  const labelOf = (repoPath) => templateOf.get(repoPath) ?? (repoPath ? `harness/${repoPath}` : `${skill.name}/templates`);
  if (copied.length > 0) {
    runTsc(app, labelOf, report);
    if (!context.options['no-lint']) runEslint(app, copied, labelOf, report);
    if (!context.options['no-prettier']) runPrettier(app, unchanged, labelOf, report);
    if (!context.options['no-jest']) {
      const code = copied.filter((file) => CODE_EXTENSIONS.has(extname(file)) || file.endsWith('.json'));
      const sims = copied.filter((file) => file.endsWith('.sim.test.ts'));
      // Jest keys its haste map and transform cache by rootDir, and every run has a new temp rootDir, so a
      // shared cache is never reused and only grows. Keep it inside the temp app, which is removed below.
      const cacheDir = join(app, '.jest-cache');
      const ran = code.length > 0 ? runJest(app, ['--findRelatedTests', ...code], labelOf, report, cacheDir) : 0;
      const simRan = sims.length > 0 ? runJest(app, ['--config', 'jest.sim.config.js', '--runTestsByPath', ...sims], labelOf, report, cacheDir) : 0;
      report.note(`verify-templates: ${skill.name}: ${ran + simRan} related tests ran`);
    }
  }
  if (context.options.keep) report.note(`kept: ${app}`);
  else rmSync(app, { recursive: true, force: true });
  return { checked: templates.length, applicable: true };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const repoTemplates = resolve(options['repo-templates'] ?? DEFAULT_REPO_TEMPLATES);
  const harnessSource = resolve(options['harness-source'] ?? DEFAULT_HARNESS_SOURCE);
  const skillsRoot = resolve(options['skills-root'] ?? DEFAULT_SKILLS_ROOT);
  if (!isDir(repoTemplates)) throw new UsageError(`repo-templates folder ${repoTemplates} does not exist`, 'Run from a ReactNative-Skills checkout, or pass --repo-templates <dir>.');
  if (!existsSync(join(harnessSource, 'package.json'))) throw new UsageError(`harness source ${harnessSource} has no package.json`, 'Run from a ReactNative-Skills checkout, or pass --harness-source <dir>.');
  const report = createReporter('verify-templates');
  if (options['sync-harness']) {
    syncHarness(repoTemplates, harnessSource, report);
    syncAdopted(harnessSource, skillsRoot, report);
  }
  const canonicalChecked = checkDrift(repoTemplates, harnessSource, skillsRoot, report);
  if (positionals.length === 0) return report.finish({ checked: canonicalChecked, unit: 'canonical and adopted files' });
  const skills = positionals.map((arg) => resolveSkill(arg, skillsRoot));
  const installed = resolveInstalledHarness(options, harnessSource);
  report.note(`verify-templates: harness ${toPosix(relative(process.cwd(), harnessSource)) || '.'} (node_modules from ${installed})`);
  checkStale(installed, harnessSource, report);
  const context = { options, harnessSource, installed, repoTemplates };
  const results = skills.map((skill) => ({ skill, ...verifySkill(skill, context, report) }));
  const applicable = results.filter((result) => result.applicable);
  for (const result of results.filter((entry) => !entry.applicable)) report.note(`verify-templates: ${result.reason}: NOT APPLICABLE`);
  if (applicable.length === 0 && report.count === 0) return report.notApplicable(results.map((result) => result.reason).join('; '));
  return report.finish({ checked: applicable.reduce((sum, result) => sum + result.checked, 0), unit: 'templates' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(main);
