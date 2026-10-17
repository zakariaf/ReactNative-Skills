// env-scan.mjs: helpers shared by this skill's checkers (a helper, not an entry point).
//   Variants and names: VARIANTS, PUBLIC_PREFIX, ALWAYS_INLINED, VARIANT_ENV, SERVER_ONLY_PROVIDERS,
//          nameWords(name), isSecretName(name)
//   Secret values: SECRET_VALUE_PATTERNS, secretValueKind(text), findSecretValues(text)
//   Files: CONFIG_FILES, METRO_FILES, findFirst(dir, names), resolveAppDir(root, given), envFilesIn(dir),
//          parseDotenv(text)
//   Git: readGitignore(dir, prefix), isIgnored(rules, rel), gitignoreRules(root, appDir)
//   Dotenv as Expo CLI loads it: dotenvLoadOrder(mode), committedDotenv(root, appDir, mode)
//   EAS: readEasJson(path), resolveProfile(build, name)
//   Sources: envNamesIn(source), localImportClosure(root, rel), lineAt(text, needle)
//   App code: CODE_FILE_GLOBS, insideDir(rel, dir), appLayouts(layout), appCode(root, layout)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';

import { globToRegExp, isRepoScanIgnored, lineOf, parseJsonc, resolveLayout, toPosix, UsageError, walkRepo } from '../check-lib.mjs';
import { importsOf, isTestFile, resolveImport, scanSource } from './source-scan.mjs';

export const VARIANTS = Object.freeze(['development', 'preview', 'production']);
export const PUBLIC_PREFIX = 'EXPO_PUBLIC_';
/** Inlined by babel-preset-expo / Metro in every bundle, so reading them anywhere is fine. */
export const ALWAYS_INLINED = Object.freeze(['NODE_ENV', 'EXPO_OS']);
/** The two variables that name the variant: the config reads the first, Metro inlines the second. */
export const VARIANT_ENV = Object.freeze(['APP_VARIANT', 'EXPO_PUBLIC_APP_VARIANT']);
export const CONFIG_FILES = Object.freeze(['app.config.ts', 'app.config.mts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']);
export const METRO_FILES = Object.freeze(['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts']);

// A name is secret-looking when one of its words (split on "_" and camelCase) says so. "KEY" alone is
// not: many public client keys (a Maps key restricted to the app id, a Stripe publishable key, a
// Supabase anon key, a RevenueCat public SDK key) are meant to ship in the app.
const SECRET_WORDS = new Set([
  'SECRET', 'SECRETS', 'PRIVATE', 'PASSWORD', 'PASSWD', 'PASSPHRASE', 'TOKEN', 'TOKENS',
  'CREDENTIAL', 'CREDENTIALS', 'SIGNING', 'KEYSTORE', 'WEBHOOK',
]);
// TOKEN and PRIVATE also describe public settings: a name that ends in one of these words is the
// setting, not the secret (EXPO_PUBLIC_AUTH_TOKEN_ENDPOINT, EXPO_PUBLIC_PRIVATE_BETA_ENABLED).
const SOFT_SECRET_WORDS = new Set(['TOKEN', 'TOKENS', 'PRIVATE']);
const SETTING_SUFFIXES = new Set(['URL', 'URLS', 'ENDPOINT', 'URI', 'INTERVAL', 'TTL', 'MS', 'ENABLED']);
const SECRET_PAIRS = [['SERVICE', 'ROLE'], ['SERVICE', 'ACCOUNT'], ['ADMIN', 'KEY'], ['MASTER', 'KEY'], ['ROOT', 'KEY'], ['ENCRYPTION', 'KEY'], ['HMAC', 'KEY']];
/**
 * Paid or LLM APIs whose keys are server-only: every key bills the account and none is restricted to
 * the app. A name with one of these words and KEY (OPENAI_API_KEY, anthropicApiKey) is secret-looking.
 * Words are also matched joined with their neighbour, so OPEN_AI, openAi, HUGGING_FACE, ELEVEN_LABS,
 * DEEP_SEEK and GOOGLE_GENAI count as the provider.
 */
export const SERVER_ONLY_PROVIDERS = Object.freeze([
  'OPENAI', 'ANTHROPIC', 'CLAUDE', 'GEMINI', 'GENAI', 'GOOGLEAI', 'VERTEX', 'MISTRAL', 'COHERE', 'GROQ',
  'XAI', 'DEEPSEEK', 'PERPLEXITY', 'OPENROUTER', 'TOGETHER', 'FIREWORKS', 'REPLICATE', 'HUGGINGFACE',
  'STABILITY', 'ELEVENLABS', 'DEEPGRAM', 'ASSEMBLYAI', 'PINECONE', 'TWILIO', 'SENDGRID', 'MAILGUN',
  'RESEND', 'POSTMARK',
]);
const PROVIDERS = new Set(SERVER_ONLY_PROVIDERS);
const KEY_WORDS = new Set(['KEY', 'APIKEY', 'KEYS']);

/** The upper-case words of a variable or key name (UPPER_SNAKE or camelCase), EXPO_PUBLIC_ removed. */
export function nameWords(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().replace(/^EXPO_PUBLIC_/, '').split(/[^A-Z0-9]+/).filter(Boolean);
}

/** True when a variable or key name (UPPER_SNAKE or camelCase, with or without EXPO_PUBLIC_) names a secret. */
export function isSecretName(name) {
  const words = nameWords(name);
  const setting = SETTING_SUFFIXES.has(words.at(-1));
  if (words.some((word) => SECRET_WORDS.has(word) && !(setting && SOFT_SECRET_WORDS.has(word)))) return true;
  // Each word and each pair of neighbours joined: OPEN_AI -> OPENAI, API_KEY -> APIKEY.
  const joined = [...words, ...words.slice(1).map((word, index) => `${words[index]}${word}`)];
  if (joined.some((word) => PROVIDERS.has(word)) && joined.some((word) => KEY_WORDS.has(word))) return true;
  return words.some((word, index) => SECRET_PAIRS.some(([first, second]) => word === first && words[index + 1] === second));
}

/** Values that are secrets whatever their variable is called. */
export const SECRET_VALUE_PATTERNS = Object.freeze([
  { id: 'private-key', what: 'a PEM private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'service-account', what: 'a Google service-account key file', re: /"type"\s*:\s*"service_account"/ },
  // Anthropic before OpenAI: both start with sk-.
  { id: 'anthropic-key', what: 'an Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  // In bytecode the bare sk- form needs the 48 characters of a legacy key: without word boundaries a
  // shorter run after "...sk-" is too common.
  { id: 'openai-key', what: 'an OpenAI API key', re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/, binary: /sk-(?:proj|svcacct|admin)-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}|sk-(?!ant-|proj-|svcacct-|admin-)(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{48}/ },
  { id: 'stripe-secret', what: 'a Stripe secret or restricted key (live or test)', re: /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}/ },
  { id: 'huggingface-token', what: 'a Hugging Face token', re: /\bhf_[A-Za-z0-9]{30,}/ },
  { id: 'replicate-token', what: 'a Replicate API token', re: /\br8_[A-Za-z0-9]{30,}/ },
  { id: 'groq-key', what: 'a Groq API key', re: /\bgsk_[A-Za-z0-9]{40,}/ },
  { id: 'aws-access-key', what: 'an AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', what: 'a GitHub token', re: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { id: 'slack-token', what: 'a Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'npm-token', what: 'an npm access token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'sentry-token', what: 'a Sentry auth token', re: /\bsntr[ysu]_[A-Za-z0-9+/=_-]{20,}/ },
  // scheme://user:password@host (postgres, mysql, mongodb+srv, redis, amqp, https). A loopback host
  // (a docker-compose default in .env.example) and a ${VAR} or <placeholder> password are not secrets.
  { id: 'url-credentials', what: 'a connection string with a password', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]*:(?![$<*{%])[^\s/@'"`]+@(?!(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(?:[:/?#'"`]|$))[^\s/:@'"`]/i },
]);

/** The first secret pattern a text matches, or null. */
export function secretValueKind(text) {
  if (typeof text !== 'string' || text === '') return null;
  return SECRET_VALUE_PATTERNS.find((entry) => entry.re.test(text)) ?? null;
}

/**
 * The pattern for binary input. Hermes bytecode packs its string table without separators and shares
 * overlapping characters between strings (a key "sk-proj-..." can sit inside "...RenderMask-proj-...",
 * verified on an SDK 57 export), so word boundaries around a literal do not hold there.
 */
function binaryPattern(entry) {
  if (entry.binary) return entry.binary;
  const source = entry.re.source.replace(/^\\b/, '').replace(/\\b$/, '').replaceAll('|\\b', '|').replaceAll('\\b|', '|');
  return new RegExp(source, entry.re.flags);
}

/** Every secret pattern match in a text: [{ entry, index }]. `binary` drops word boundaries (bytecode). */
export function findSecretValues(text, { binary = false } = {}) {
  const found = [];
  for (const entry of SECRET_VALUE_PATTERNS) {
    const re = new RegExp((binary ? binaryPattern(entry) : entry.re).source, 'g');
    for (const match of text.matchAll(re)) found.push({ entry, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** The first of `names` that exists as a file in `dir`, or null. */
export function findFirst(dir, names) {
  return names.find((name) => isFile(join(dir, name))) ?? null;
}

export function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** .env, .env.local, .env.production, .env.example ... directly inside `dir`, sorted. */
export function envFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /^\.env(?:\..+)?$/.test(name) && isFile(join(dir, name))).sort();
}

/**
 * The app folder: --app-dir when given; else the repo root when it holds an app config; else the one
 * workspace (package.json "workspaces", through resolveLayout) that holds one. Several candidates and
 * no --app-dir is bad input.
 */
export function resolveAppDir(root, given) {
  if (given !== undefined) return given;
  if (findFirst(root, [...CONFIG_FILES, 'app.json']) !== null) return '.';
  const apps = resolveLayout(root).workspaces.filter((ws) => findFirst(join(root, ws.dir), [...CONFIG_FILES, 'app.json']) !== null);
  if (apps.length === 1) return apps[0].dir;
  if (apps.length > 1) throw new UsageError(`several workspaces hold an app config (${apps.map((ws) => ws.dir).join(', ')})`, 'Pass the app to check with --app-dir <dir>.');
  return '.';
}

/** dotenv lines: [{ name, value, line }] (comments, blank lines and malformed lines left out). */
export function parseDotenv(text) {
  const entries = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!match) return;
    let value = match[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    entries.push({ name: match[1], value, line: index + 1 });
  });
  return entries;
}

/**
 * A .gitignore as rules for isIgnored(). `prefix` is the folder of the .gitignore relative to the
 * repo root ('' for the root file). Simplified git semantics: the last matching rule wins, "!"
 * negates, a trailing "/" matches folders only, a "/" elsewhere anchors the pattern to its folder.
 */
export function readGitignore(dir, prefix = '') {
  const path = join(dir, '.gitignore');
  if (!isFile(path)) return null;
  const rules = [];
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\s+$/, '');
    if (line === '' || line.startsWith('#')) return;
    const negate = line.startsWith('!');
    let pattern = negate ? line.slice(1) : line;
    const dirOnly = pattern.endsWith('/');
    if (dirOnly) pattern = pattern.slice(0, -1);
    const anchored = pattern.includes('/');
    pattern = pattern.replace(/^\//, '');
    if (pattern === '') return;
    rules.push({ negate, dirOnly, anchored, prefix, re: globToRegExp(pattern), text: line, line: index + 1 });
  });
  return rules;
}

/** True when `rel` (repo-relative, posix) is ignored by the rules of one or more .gitignore files. */
export function isIgnored(rules, rel) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.prefix !== '' && !rel.startsWith(`${rule.prefix}/`)) continue;
    const local = rule.prefix === '' ? rel : rel.slice(rule.prefix.length + 1);
    if (ruleMatches(rule, local)) ignored = !rule.negate;
  }
  return ignored;
}

function ruleMatches(rule, rel) {
  const parts = rel.split('/');
  // The path itself (files only for a folder rule), then every parent folder (ignoring a folder
  // ignores what is inside it).
  const candidates = [];
  for (let end = parts.length; end >= 1; end -= 1) {
    if (rule.dirOnly && end === parts.length) continue;
    candidates.push(parts.slice(0, end));
  }
  return candidates.some((segments) => (rule.anchored ? rule.re.test(segments.join('/')) : rule.re.test(segments.at(-1))));
}

/**
 * The .gitignore rules that apply to the app: the repo root's file plus, when the app sits in a
 * workspace, the app folder's own file. null when neither exists.
 */
export function gitignoreRules(root, appDir) {
  const rootRules = readGitignore(root, '');
  const appPrefix = toPosix(relative(root, appDir));
  const appRules = appPrefix === '' ? null : readGitignore(appDir, appPrefix);
  if (rootRules === null && appRules === null) return null;
  return [...(rootRules ?? []), ...(appRules ?? [])];
}

/** The env files Expo CLI loads for a NODE_ENV, first one wins (@expo/env, the dotenv convention). */
export function dotenvLoadOrder(mode) {
  return [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env'];
}

/**
 * The variables Expo CLI would load from env files that git would commit (not ignored), in its load
 * order for `mode`: { values: { NAME: value }, from: { NAME: '.env' } }. Ignored files (.env.local) stay
 * on one machine, so a checker does not read them.
 */
export function committedDotenv(root, appDir, mode = 'development') {
  const rules = gitignoreRules(root, appDir);
  const values = {};
  const from = {};
  for (const name of dotenvLoadOrder(mode)) {
    const rel = toPosix(relative(root, join(appDir, name)));
    if (!isFile(join(appDir, name)) || (rules !== null && isIgnored(rules, rel))) continue;
    for (const entry of parseDotenv(readFileSync(join(appDir, name), 'utf8'))) {
      if (entry.name in values) continue;
      values[entry.name] = entry.value;
      from[entry.name] = rel;
    }
  }
  return { values, from };
}

/** eas.json as { data, text } (comments allowed), null when missing; malformed is bad input. */
export function readEasJson(path, label = toPosix(path)) {
  if (!isFile(path)) return null;
  const text = readFileSync(path, 'utf8');
  try {
    return { data: parseJsonc(text), text };
  } catch (error) {
    throw new UsageError(`${label} is not valid JSON: ${error.message}`, 'Fix the JSON syntax of eas.json.');
  }
}

/**
 * A build profile with its `extends` chain applied (env, ios and android merged one level deep).
 * Returns { profile } or { error } (a missing parent or a cycle).
 */
export function resolveProfile(build, name, seen = []) {
  const own = build?.[name];
  if (own === undefined || own === null || typeof own !== 'object') return { error: `build profile "${name}" does not exist` };
  if (seen.includes(name)) return { error: `build profile "${name}" extends itself (${[...seen, name].join(' -> ')})` };
  if (typeof own.extends !== 'string') return { profile: own };
  const parent = resolveProfile(build, own.extends, [...seen, name]);
  if (parent.error) return parent;
  const merged = { ...parent.profile, ...own };
  for (const key of ['env', 'ios', 'android']) {
    if (parent.profile[key] || own[key]) merged[key] = { ...(parent.profile[key] ?? {}), ...(own[key] ?? {}) };
  }
  for (const platform of ['ios', 'android']) {
    const parentEnv = parent.profile[platform]?.env;
    const ownEnv = own[platform]?.env;
    if (parentEnv || ownEnv) merged[platform] = { ...merged[platform], env: { ...(parentEnv ?? {}), ...(ownEnv ?? {}) } };
  }
  return { profile: merged };
}

/** Environment variable names a source reads: process.env.X, process.env['X'], env.X, env['X']. */
export function envNamesIn(source) {
  const names = new Set();
  const patterns = [
    /\bprocess\.env\??\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /\bprocess\.env\??\.?\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g,
    /\benv\??\.([A-Z][A-Z0-9_]+)\b/g,
    /\benv\??\.?\[\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*\]/g,
  ];
  for (const re of patterns) for (const match of source.matchAll(re)) names.add(match[1]);
  return names;
}

const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
const PROBE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'];

/** `rel` and every local file it reaches through relative imports (repo-relative posix paths). */
export function localImportClosure(root, rel, limit = 200) {
  const seen = new Set();
  const queue = [rel];
  while (queue.length > 0 && seen.size < limit) {
    const file = queue.shift();
    if (seen.has(file) || !isFile(join(root, file))) continue;
    seen.add(file);
    const text = readFileSync(join(root, file), 'utf8');
    for (const match of text.matchAll(IMPORT_SPEC)) {
      const base = posix.normalize(posix.join(posix.dirname(file), match[2]));
      if (base.startsWith('..')) continue;
      const hit = PROBE_EXTENSIONS.map((ext) => `${base}${ext}`).find((candidate) => isFile(join(root, candidate)));
      if (hit && !seen.has(hit)) queue.push(hit);
    }
  }
  return [...seen];
}

/** 1-based line of the first occurrence of `needle` (a string or RegExp) in `text`, or 1. */
export function lineAt(text, needle) {
  const index = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
  return index < 0 ? 1 : lineOf(text, index);
}

export const CODE_FILE_GLOBS = Object.freeze(['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs']);
const CODE_EXTENSION = /\.[cm]?[jt]sx?$/;
// Node tooling at the top of an app folder that uses the folder itself as its source root:
// app.config.ts, metro.config.js, babel.config.js, jest.setup.ts, ...
const ROOT_TOOLING_FILE = /^[^/]+\.(?:config|setup)\.[cm]?[jt]sx?$/;
// Where Expo starts the bundle when package.json "main" is not a local file (expo/AppEntry.js registers the App component at the app root).
const ENTRY_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'App.ts', 'App.tsx', 'App.js', 'App.jsx'];
const CLOSURE_LIMIT = 20000;

/** True when the repo-relative `rel` is `dir` or inside it; '' and '.' stand for the whole repo. */
export function insideDir(rel, dir) {
  return dir === '' || dir === '.' || rel === dir || rel.startsWith(`${dir}/`);
}

/**
 * The root app and each workspace as { dir, srcDir, routesDir, configDir, tooling, aliases, sourceIsFolder }:
 * `tooling` lists the folders of Node tooling and tests (scripts, test, __mocks__, e2e, contracts,
 * local config plugins), `sourceIsFolder` is true when srcDir is the app folder itself ("srcDir": ".").
 * Without tsconfig paths the Expo template's @/* alias is assumed.
 */
export function appLayouts(layout) {
  const pick = (l, dir) => {
    const sourceIsFolder = l.srcDir === '.' || l.srcDir === '' || l.srcDir === dir;
    return {
      dir, srcDir: l.srcDir, routesDir: l.routesDir, configDir: l.configDir, sourceIsFolder,
      tooling: [l.scriptsDir, l.testDir, l.mocksDir, l.e2eDir, l.contractsDir, dir === '' ? 'plugins' : `${dir}/plugins`],
      aliases: l.aliases.length > 0 ? l.aliases : [{ pattern: '@/*', targets: [sourceIsFolder ? (dir === '' ? '*' : `${dir}/*`) : `${l.srcDir}/*`] }],
    };
  };
  return [pick(layout, ''), ...layout.workspaces.map((ws) => pick(ws.layout, ws.dir))];
}

/**
 * The app code of a repo, the way the bundler reaches it (tests and declarations left out of `code`):
 *   - each app's srcDir, and its routesDir when that lies outside srcDir (Expo Router's root app/);
 *   - with "srcDir": "." the whole app folder, minus Node tooling (*.config.*, *.setup.*, scripts/,
 *     test/, __mocks__/, plugins/, the e2e and contracts folders) and other workspaces;
 *   - the app entry: package.json "main" when it is a local file, else index.* or App.* in the app folder;
 *   - every local file those reach through import, export ... from, import() and require(), wherever it
 *     lives (a root components/ folder a route imports), aliases resolved.
 * Returns { code, declarations, apps, appOf(rel), roots } (roots: the folders that were scanned whole).
 */
export function appCode(root, layout) {
  const apps = appLayouts(layout);
  const workspaceDirs = apps.filter((app) => app.dir !== '').map((app) => app.dir);
  const appOf = (rel) => apps.filter((app) => insideDir(rel, app.dir)).sort((a, b) => b.dir.length - a.dir.length)[0] ?? apps[0];
  const inFolderSource = (app, rel) => {
    if (!insideDir(rel, app.dir) || appOf(rel) !== app) return false;
    const local = app.dir === '' ? rel : rel.slice(app.dir.length + 1);
    if (ROOT_TOOLING_FILE.test(local)) return false;
    return !app.tooling.some((dir) => insideDir(rel, dir) && dir !== '' && dir !== '.') && !workspaceDirs.some((dir) => dir !== app.dir && insideDir(rel, dir));
  };
  const roots = [];
  for (const app of apps) {
    if (app.sourceIsFolder) roots.push(app.dir === '' ? '.' : app.dir);
    else {
      roots.push(app.srcDir);
      if (!insideDir(app.routesDir, app.srcDir)) roots.push(app.routesDir);
    }
  }
  const inRoot = (rel) => apps.some((app) => (app.sourceIsFolder ? inFolderSource(app, rel) : insideDir(rel, app.srcDir) || (!insideDir(app.routesDir, app.srcDir) && insideDir(rel, app.routesDir))));
  const walked = walkRepo(root, { include: [...CODE_FILE_GLOBS] }).filter(inRoot);
  const declarations = walked.filter((rel) => rel.endsWith('.d.ts'));
  const isCode = (rel) => CODE_EXTENSION.test(rel) && !rel.endsWith('.d.ts') && !isTestFile(rel);
  const found = new Set(walked.filter(isCode));
  const queue = [...found];
  for (const app of apps) {
    for (const entry of entryFiles(root, app.dir)) {
      if (!found.has(entry) && isCode(entry) && !isRepoScanIgnored(entry, root)) {
        found.add(entry);
        queue.push(entry);
      }
    }
  }
  while (queue.length > 0 && found.size < CLOSURE_LIMIT) {
    const rel = queue.shift();
    let scan;
    try {
      scan = scanSource(readFileSync(join(root, rel), 'utf8'));
    } catch {
      continue;
    }
    for (const entry of importsOf(scan)) {
      if (entry.typeOnly) continue;
      const target = resolveImport(rel, entry.spec, { root, aliases: appOf(rel).aliases });
      if (target.kind !== 'local' || !target.exists || found.has(target.path) || !isCode(target.path) || isRepoScanIgnored(target.path, root)) continue;
      found.add(target.path);
      queue.push(target.path);
    }
  }
  return { code: [...found].sort(), declarations, apps, appOf, roots };
}

/** The local entry files of one app folder: package.json "main" when local, else index.* and App.*. */
function entryFiles(root, dir) {
  const at = (name) => (dir === '' ? name : `${dir}/${name}`);
  let main = null;
  try {
    main = JSON.parse(readFileSync(join(root, at('package.json')), 'utf8')).main;
  } catch {
    main = null;
  }
  if (typeof main === 'string' && /^\.{0,2}\/?[\w@-]/.test(main) && !main.startsWith('/')) {
    const rel = posix.normalize(at(main));
    const hit = ['', '.ts', '.tsx', '.js', '.jsx'].map((ext) => `${rel}${ext}`).find((candidate) => !candidate.startsWith('..') && !candidate.includes('node_modules/') && isFile(join(root, candidate)));
    if (hit) return [hit];
  }
  return ENTRY_FILES.map(at).filter((rel) => isFile(join(root, rel)));
}
