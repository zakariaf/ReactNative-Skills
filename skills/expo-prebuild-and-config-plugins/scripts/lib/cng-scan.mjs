// cng-scan.mjs: helpers for check-native-generation.mjs. A small .gitignore matcher, the evaluation
// of app.config.ts the way Expo calls it, plugin-list normalization, and a check that the repo's Jest
// config reaches a test file. Zero dependencies (node: built-ins and check-lib only).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { globToRegExp, toPosix, UsageError } from '../check-lib.mjs';

// ---------------------------------------------------------------------------------------------
// .gitignore / .easignore matching (the subset these files use: *, **, ?, [..], leading and trailing
// slashes, negation). A pattern without a slash before its end matches a name at any depth.
// ---------------------------------------------------------------------------------------------

/** Parses ignore-file text into rules: [{ line, text, negate, dirOnly, anchored, re }]. */
export function ignoreRules(text) {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    let pattern = raw.replace(/\s+$/, '');
    if (pattern === '' || pattern.startsWith('#')) return;
    const negate = pattern.startsWith('!');
    if (negate) pattern = pattern.slice(1);
    const dirOnly = pattern.endsWith('/');
    if (dirOnly) pattern = pattern.replace(/\/+$/, '');
    if (pattern === '') return;
    const anchored = pattern.includes('/');
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    const glob = anchored ? pattern : `**/${pattern}`;
    rules.push({ line: index + 1, text: raw.trim(), negate, dirOnly, anchored, re: globToRegExp(glob) });
  });
  return rules;
}

function matchRule(rules, rel, isDir) {
  let found = null;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.re.test(rel)) found = rule;
  }
  return found;
}

/**
 * The rule that ignores `rel` (a folder when isDir), counting ignored parent folders the way git
 * does, or null when the path is not ignored.
 */
export function ignoredBy(rules, rel, isDir = true) {
  const parts = rel.split('/');
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const sub = parts.slice(0, depth).join('/');
    const rule = matchRule(rules, sub, depth < parts.length ? true : isDir);
    if (rule && !rule.negate) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Evaluating app.config.ts
// ---------------------------------------------------------------------------------------------

/** The variables a command, an EAS profile or CI sets; the checker starts every evaluation without them. */
export const STRIPPED_ENV = Object.freeze(['APP_VARIANT', 'EXPO_PUBLIC_APP_VARIANT', 'NODE_ENV', 'EAS_BUILD', 'EAS_BUILD_PROFILE', 'CI']);
const MARKER = '__RN_SKILLS_CONFIG__';

// Imports the config with Node's type stripping (the house floor is Node 22.18), calls the default
// export with a config context shaped like Expo's, and prints the result as JSON. Functions become
// { "$function": name } so plugin entries that are functions stay visible; a thenable is reported.
const EVAL_SOURCE = [
  "import { pathToFileURL } from 'node:url';",
  'const [file, contextJson, marker] = process.argv.slice(1);',
  "const encode = (value) => JSON.stringify(value, (key, item) => (typeof item === 'function' ? { $function: item.name || 'anonymous' } : item));",
  'const out = (value) => process.stdout.write(marker + JSON.stringify(value));',
  'try {',
  '  const mod = await import(pathToFileURL(file).href);',
  '  let exported = mod.default ?? mod;',
  "  if (exported && typeof exported === 'object' && typeof exported.default === 'function') exported = exported.default;",
  "  const result = typeof exported === 'function' ? exported(JSON.parse(contextJson)) : exported;",
  "  if (result !== null && typeof result === 'object' && typeof result.then === 'function') {",
  '    out({ ok: true, promise: true });',
  '  } else {',
  "    const config = result !== null && typeof result === 'object' && result.expo && typeof result.expo === 'object' ? result.expo : result;",
  '    out({ ok: true, config: config === undefined ? null : JSON.parse(encode(config)) });',
  '  }',
  '} catch (error) {',
  '  out({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) });',
  '}',
].join('\n');

function slugOf(name) {
  return String(name ?? 'app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

/** The config context Expo passes to a dynamic config when no app.json exists (@expo/config 57). */
export function configContext(appDir, configPath, manifest) {
  const packageJsonPath = join(appDir, 'package.json');
  return {
    projectRoot: appDir,
    staticConfigPath: null,
    packageJsonPath,
    config: {
      name: manifest?.name ?? 'app',
      slug: slugOf(manifest?.name),
      version: manifest?.version ?? '1.0.0',
      platforms: ['ios', 'android'],
      _internal: { isDebug: false, projectRoot: appDir, dynamicConfigPath: configPath, packageJsonPath },
    },
  };
}

/**
 * Evaluates the config once. Returns { ok: true, config } | { ok: true, promise: true } |
 * { ok: false, code, message }.
 */
export function evaluateConfig({ configPath, appDir, manifest, env, timeoutMs = 60000 }) {
  const childEnv = { ...process.env };
  for (const name of STRIPPED_ENV) delete childEnv[name];
  Object.assign(childEnv, env);
  const context = JSON.stringify(configContext(appDir, configPath, manifest));
  const result = spawnSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', EVAL_SOURCE, configPath, context, MARKER], {
    cwd: appDir,
    env: childEnv,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const at = (result.stdout ?? '').lastIndexOf(MARKER);
  if (at === -1) {
    const detail = `${result.stderr ?? ''}${result.error ? String(result.error.message) : ''}`.trim();
    return { ok: false, code: null, message: detail.split('\n')[0] || `node exited with status ${result.status}` };
  }
  return JSON.parse(result.stdout.slice(at + MARKER.length));
}

// ---------------------------------------------------------------------------------------------
// Plugin entries
// ---------------------------------------------------------------------------------------------

/** Matches Expo's own test (@expo/config-plugins 57 plugin-resolver: ./, ../, ~/ and / are file paths). */
export function isFilePath(reference) {
  return /^(\.|~\/|\/)/.test(reference);
}

/** The package a plugin reference names: 'expo-font' -> 'expo-font', '@sentry/react-native/expo' -> '@sentry/react-native'. */
export function packageOf(reference) {
  const parts = reference.split('/');
  return reference.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Normalizes config.plugins: [{ index, reference, functionName, props }]. A string entry and a
 * [string, props] entry have a reference; an imported function (serialized as { $function }) has a
 * functionName instead.
 */
export function pluginEntries(config) {
  const list = Array.isArray(config?.plugins) ? config.plugins : [];
  return list.map((entry, index) => {
    const head = Array.isArray(entry) ? entry[0] : entry;
    const props = Array.isArray(entry) ? entry[1] : undefined;
    if (typeof head === 'string') return { index, reference: head, functionName: null, props };
    if (head && typeof head === 'object' && typeof head.$function === 'string') return { index, reference: null, functionName: head.$function, props };
    return { index, reference: null, functionName: null, props };
  });
}

/** Paths of every null in a JSON value (outside `skipKeys` at the top level), e.g. ['extra.storeId']. */
export function nullPaths(value, skipKeys = ['plugins', '_internal'], prefix = '') {
  if (value === null) return [prefix || '(the config)'];
  if (Array.isArray(value)) return value.flatMap((item, index) => nullPaths(item, [], `${prefix}[${index}]`));
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => (prefix === '' && skipKeys.includes(key) ? [] : nullPaths(item, [], prefix ? `${prefix}.${key}` : key)));
}

/** The first path where two JSON values differ, or null. */
export function firstDifference(a, b, prefix = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const key of keys) {
      const found = firstDifference(a[key], b[key], Array.isArray(a) ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : key);
      if (found !== null) return found;
    }
  }
  return prefix || '(the config)';
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Parses a JSON file, or throws a UsageError naming it. */
export function readJsonFile(path, rel) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message.split('\n')[0]}`, `Fix the JSON in ${rel}.`);
  }
}

const PROBES = ['', '.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'];

/** Resolves a relative import or plugin path to an existing file, the way Expo and Node probe it. */
export function probeFile(baseDir, spec) {
  for (const suffix of PROBES) {
    const candidate = resolve(baseDir, `${spec}${suffix}`);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** 1-based line of the first occurrence of `needle` in text (1 when absent). */
export function lineOfText(text, needle) {
  const at = text.indexOf(needle);
  return at === -1 ? 1 : text.slice(0, at).split('\n').length;
}

export function relPath(root, abs) {
  return toPosix(relative(root, abs));
}

export function parentDir(path) {
  return dirname(path);
}

// ---------------------------------------------------------------------------------------------
// Jest reach: does the repo's Jest config run a given test file?
// ---------------------------------------------------------------------------------------------

export const JEST_CONFIG_FILES = Object.freeze(['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts']);
const JEST_DEFAULT_MATCH = ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'];

const JEST_EVAL_SOURCE = [
  "import { pathToFileURL } from 'node:url';",
  'const [file, marker] = process.argv.slice(1);',
  'const out = (value) => process.stdout.write(marker + JSON.stringify(value));',
  'try {',
  '  const mod = await import(pathToFileURL(file).href);',
  '  let config = mod.default ?? mod;',
  "  if (typeof config === 'function') config = await config();",
  '  config = await config;',
  "  const pick = (c) => ({ rootDir: c.rootDir ?? null, testMatch: c.testMatch ?? null, testRegex: c.testRegex ?? null, testPathIgnorePatterns: c.testPathIgnorePatterns ?? null, displayName: typeof c.displayName === 'string' ? c.displayName : c.displayName?.name ?? null });",
  "  const projects = Array.isArray(config.projects) ? config.projects.filter((p) => p && typeof p === 'object').map(pick) : [];",
  '  out({ ok: true, root: pick(config), projects });',
  '} catch (error) {',
  '  out({ ok: false, message: String(error?.message ?? error) });',
  '}',
].join('\n');

/** Loads the Jest config's test selection: { ok, file, projects: [{ rootDir, testMatch, testRegex, testPathIgnorePatterns, displayName }] }. */
export function loadJestSelection(appDir, manifest = null) {
  const name = JEST_CONFIG_FILES.find((candidate) => isFile(join(appDir, candidate)));
  if (!name && manifest?.jest && typeof manifest.jest === 'object') {
    const pick = (c) => ({ rootDir: c.rootDir ?? null, testMatch: c.testMatch ?? null, testRegex: c.testRegex ?? null, testPathIgnorePatterns: c.testPathIgnorePatterns ?? null });
    const projects = Array.isArray(manifest.jest.projects) ? manifest.jest.projects.filter((p) => p && typeof p === 'object').map(pick) : [];
    return { ok: true, file: 'package.json "jest"', projects: projects.length > 0 ? projects : [pick(manifest.jest)] };
  }
  if (!name) return { ok: false, missing: true };
  const result = spawnSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', JEST_EVAL_SOURCE, join(appDir, name), MARKER], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env },
  });
  const at = (result.stdout ?? '').lastIndexOf(MARKER);
  if (at === -1) return { ok: false, file: name, message: (result.stderr ?? '').trim().split('\n')[0] || 'the Jest config did not load' };
  const parsed = JSON.parse(result.stdout.slice(at + MARKER.length));
  if (!parsed.ok) return { ok: false, file: name, message: parsed.message };
  const projects = parsed.projects.length > 0 ? parsed.projects : [parsed.root];
  return { ok: true, file: name, projects };
}

function withRoot(pattern, rootDir) {
  return pattern.split('<rootDir>').join(rootDir);
}

function regexWithRoot(source, rootDir) {
  return new RegExp(source.split('<rootDir>').join(rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

/** Does one project's testMatch/testRegex select the absolute path, without an ignore pattern dropping it? null when undecidable. */
function projectRuns(project, appDir, absTest) {
  const rootDir = project.rootDir ? resolve(appDir, project.rootDir) : appDir;
  const ignores = (project.testPathIgnorePatterns ?? ['/node_modules/']).map((source) => regexWithRoot(source, rootDir));
  if (ignores.some((re) => re.test(absTest))) return false;
  if (project.testRegex) {
    const sources = [project.testRegex].flat();
    return sources.some((source) => new RegExp(source).test(absTest));
  }
  const globs = project.testMatch ?? JEST_DEFAULT_MATCH;
  let decidable = true;
  for (const glob of globs) {
    if (/[?+*@!]\(/.test(glob)) {
      decidable = false;
      continue;
    }
    const resolved = withRoot(glob, rootDir);
    const re = globToRegExp(resolved.startsWith('/') ? resolved : `**/${resolved}`);
    if (re.test(resolved.startsWith('/') ? absTest : absTest.replace(/^\//, ''))) return true;
  }
  return decidable ? false : null;
}

/** true | false | null (cannot tell): does any Jest project run the test file? */
export function jestRuns(selection, appDir, absTest) {
  let unknown = false;
  for (const project of selection.projects) {
    const runs = projectRuns(project, appDir, absTest);
    if (runs === true) return true;
    if (runs === null) unknown = true;
  }
  return unknown ? null : false;
}

export function fileExists(path) {
  return existsSync(path);
}
