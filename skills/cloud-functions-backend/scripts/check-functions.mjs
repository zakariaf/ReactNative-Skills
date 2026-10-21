#!/usr/bin/env node
// check-functions.mjs: checks the app's Cloud Functions source (2nd gen, TypeScript or JavaScript): App
// Check and auth on every callable, input parsed before use, secrets only through bound defineSecret
// params, no provider keys in source or committed env files, limits on every function, no 1st-gen API.
// Static scan; zero dependencies.
//   node <this skill>/scripts/check-functions.mjs [repo-root] [--functions-dir <dir>]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, maskComments, parseArgs, parseJsonc, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { topLevelEntries } from './lib/object-literal.mjs';
import { findClosing, makeLineOf, maskCode } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-functions',
  summary: 'Checks the Cloud Functions source of the app: App Check and auth on every callable, input parsed with a schema before use, secrets only through defineSecret params bound on the function, no provider keys in source or committed env files, region and limits on every function, and no 1st-gen API.',
  usage: '[repo-root] [options]',
  positionals: { min: 0, max: 1 },
  options: {
    'functions-dir': { type: 'string', value: 'dir', help: 'The functions folder, relative to the repo root (default: rn-skills.config.json "functionsDir", else every firebase.json functions "source", else functions)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  details: [
    'Rules:',
    '  missing-app-check    every onCall sets enforceAppCheck: true (or setGlobalOptions does); a callable that',
    '                       binds a secret (a cost-bearing call) also sets consumeAppCheckToken: true; a',
    '                       wrapper call (callableWrappers) never sets enforceAppCheck: false',
    '  missing-auth-check   a file with an onCall checks request.auth (if (!request.auth), auth === undefined,',
    '                       or a require/assert/ensure...Auth(...) helper) before work',
    '  unvalidated-input    request.data is only read as an argument of a parse call (v.parse, v.safeParse,',
    '                       parseEnvelope, ...); a wrapper call passes an input schema (input: ...)',
    '  env-secret           no process.env read of a secret-like name (KEY, SECRET, TOKEN, PASSWORD, AUTH,',
    '                       CREDENTIAL, PRIVATE), no process.env[...] or destructuring; a defineSecret param',
    '                       read with .value() is bound in the same file (secrets: [NAME]). Tests are exempt',
    '  literal-key          no provider key, token or private key as a literal in functions source, tests',
    '                       included, or in a committed env file of the functions folder (*.local is exempt)',
    '  unbounded-instances  every 2nd-gen trigger gets region, maxInstances, timeoutSeconds and memory from',
    '                       its own options or from setGlobalOptions',
    '  v1-api               no firebase-functions/v1 import (nor the root entry point while the package',
    '                       declares firebase-functions below 6), no functions.config(), runWith() or a',
    '                       1st-gen shape such as schedule(...).onRun() or document(...).onCreate()',
    'Functions folders: --functions-dir, else rn-skills.config.json "functionsDir" (a string or a list),',
    'else each firebase.json "functions" source (an object or a list of codebases), else functions/.',
    'rn-skills.config.json "callableWrappers": ["defineCallable"] names the functions that wrap onCall',
    '(default ["defineCallable"]); the wrapper itself is checked through its own onCall.',
    'A missing functions folder, or one with no source files, is exit 2.',
  ].join('\n'),
};

const FF = 'firebase-functions';
const SOURCE_GLOB = '**/*.{ts,mts,cts,js,mjs,cjs}';
const OUTPUT_DIRS = ['lib', 'dist', 'build', 'coverage', '.firebase'];
// 1st-gen shapes: functions.config(), runWith(), schedule(...).onRun(), document(...).onCreate(), ...
const V1_SHAPES = /\b[\w$]+\s*\.\s*config\s*\(\s*\)|\.\s*runWith\s*\(|\.\s*(?:schedule|topic)\s*\([^()]*\)\s*\.\s*on(?:Run|Publish)\s*\(|\.\s*(?:document|ref|object)\s*\([^()]*\)\s*\.\s*on(?:Create|Update|Delete|Write|Finalize|Archive|MetadataUpdate)\s*\(/g;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;
const LIMIT_KEYS = ['region', 'maxInstances', 'timeoutSeconds', 'memory'];
const TRIGGER_NAME = /^(?:on[A-Z]\w*|before[A-Z]\w*)$/;
const CALLABLE_TRIGGERS = new Set(['onCall', 'onCallGenkit']);
const NON_TRIGGER_SPECS = new Set(['firebase-functions/params', 'firebase-functions/logger', 'firebase-functions/logger/compat', 'firebase-functions/options', 'firebase-functions/v2/options', 'firebase-functions/core', 'firebase-functions/v2/core']);
const SECRET_WORD = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTH|CREDENTIAL|CREDENTIALS|PRIVATE|BEARER)/;
// Built from parts so this file does not look like a key to secret scanners.
const PRIVATE_KEY = new RegExp(`-----BEGIN (?:[A-Z]+ )?${'PRIV'}${'ATE'} KEY-----`);
const KEY_PATTERNS = [
  { name: 'an Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'an OpenAI-style secret key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'a Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'a Stripe live key', re: /\b[rs]k_live_[0-9A-Za-z]{16,}/ },
  { name: 'a GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'a Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'an AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'a private key', re: PRIVATE_KEY },
];
// name = '<long opaque value>' where the name says it is a secret.
const NAMED_SECRET = /\b([A-Za-z_$][\w$]*)\s*[:=]\s*(['"`])([A-Za-z0-9_\-+/=.]{20,})\2/g;

const AUTH_CHECK = [
  /!\s*[\w$]+(?:\?)?\.auth\b(?!\s*\.)/,
  /[\w$]+\.auth\s*(?:===|==|!==|!=)\s*(?:undefined|null)\b/,
  /\b(?:undefined|null)\s*(?:===|==|!==|!=)\s*[\w$]+\.auth\b/,
  /\b(?:require|assert|ensure)\w*Auth\w*\s*\(/,
];

function prefixed(dir, rel) {
  return dir === '.' || dir === '' ? rel : `${dir}/${rel}`;
}

/** The functions folders to scan, with where each came from. */
function functionsDirs(layout, given) {
  if (given !== undefined) return [{ dir: given, from: '--functions-dir' }];
  const configured = layout.config.functionsDir;
  if (configured !== undefined) {
    const list = Array.isArray(configured) ? configured : [configured];
    if (list.length === 0 || list.some((dir) => typeof dir !== 'string' || dir.trim() === '')) {
      throw new UsageError('rn-skills.config.json "functionsDir" must be a folder or a list of folders', 'Write "functionsDir": "functions" (repo-relative).');
    }
    return list.map((dir) => ({ dir, from: 'rn-skills.config.json functionsDir' }));
  }
  const firebaseJson = join(layout.root, 'firebase.json');
  if (existsSync(firebaseJson)) {
    let data;
    try {
      data = parseJsonc(readFileSync(firebaseJson, 'utf8'));
    } catch (error) {
      throw new UsageError(`firebase.json is not valid JSON: ${error.message}`, 'Fix firebase.json.');
    }
    const entries = Array.isArray(data?.functions) ? data.functions : data?.functions ? [data.functions] : [];
    if (entries.length > 0) return entries.map((entry) => ({ dir: typeof entry?.source === 'string' ? entry.source : 'functions', from: 'firebase.json functions source' }));
  }
  return [{ dir: 'functions', from: 'default' }];
}

function cleanDir(dir) {
  const normal = posix.normalize(dir.replaceAll('\\', '/')).replace(/\/+$/, '');
  if (normal.startsWith('/') || normal.split('/').includes('..')) {
    throw new UsageError(`the functions folder must be repo-relative, got ${dir}`, 'Pass a folder inside the repo, for example functions.');
  }
  return normal === '' ? '.' : normal;
}

/** Imports of firebase-functions: [{ spec, index, names: Map local -> imported, namespace }]. */
function firebaseImports(code, masked) {
  const out = [];
  // An ESM import clause from the package, or a CommonJS const destructuring of its require call.
  // Built from parts so the validator does not read this pattern as a package import of the script.
  const re = new RegExp(String.raw`\bimport\s+([^;]*?)\s+from\s*(['"])(${FF}(?:\/[^'"]*)?)\2|\b(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*${'req'}${'uire'}\s*\(\s*(['"])(${FF}(?:\/[^'"]*)?)\5\s*\)`, 'g');
  for (const match of code.matchAll(re)) {
    if (!/[a-z]/.test(masked.slice(match.index, match.index + 1))) continue; // inside a comment or string
    const cjs = match[6] !== undefined;
    const spec = match[3] ?? match[6];
    const clause = (match[1] ?? match[4] ?? '').trim();
    const names = new Map();
    let namespace = null;
    const ns = /\*\s*as\s+([\w$]+)/.exec(clause);
    if (ns) namespace = ns[1];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const piece = part.trim().replace(/^type\s+/, '');
        if (!piece) continue;
        const [imported, local] = piece.split(cjs ? /\s*:\s*/ : /\s+as\s+/).map((word) => word.trim());
        names.set(local ?? imported, imported);
      }
    }
    const defaultName = /^([\w$]+)\s*(?:,|$)/.exec(clause);
    if (defaultName && !clause.startsWith('{') && !clause.startsWith('*')) namespace = namespace ?? defaultName[1];
    out.push({ spec, index: match.index, names, namespace, cjs });
  }
  return out;
}

/** Calls of `pattern` in masked code: [{ start, open, close }]. */
function callsOf(masked, pattern) {
  const calls = [];
  const re = new RegExp(`(?<![\\w$.])${pattern}\\s*\\(`, 'g');
  for (const match of masked.matchAll(re)) {
    const before = masked.slice(Math.max(0, match.index - 12), match.index);
    if (/\bfunction\s+$/.test(before)) continue;
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open);
    if (close !== -1) calls.push({ start: match.index, open, close });
  }
  return calls;
}

/** The first argument's object literal entries, or null when the first argument is not an object literal. */
function optionsOf(call, masked, kept) {
  let i = call.open + 1;
  while (i < call.close && /\s/.test(masked[i])) i += 1;
  if (masked[i] !== '{') return null;
  const end = findClosing(masked, i);
  if (end === -1) return null;
  const entries = topLevelEntries(kept.slice(i + 1, end));
  return { entries: new Map(entries.map((entry) => [entry.key, entry.value.trim()])), end };
}

/** The identifier of the call that directly encloses `index` (innermost open paren), or null. */
function enclosingCallee(masked, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = masked[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      if (ch !== '(') return null;
      const callee = /([\w$]+)\s*(?:<[^()]*>)?\s*$/.exec(masked.slice(Math.max(0, i - 80), i));
      return callee ? callee[1] : null;
    }
  }
  return null;
}

function isTrue(value) {
  return value === 'true';
}

function nonEmptyArray(value) {
  return value !== undefined && /^\[\s*[^\s\]]/.test(value);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const layout = resolveLayout(positionals[0] ?? '.');
  const report = createReporter({ name: 'check-functions', json: options.json });
  const wrappers = Array.isArray(layout.config.callableWrappers) ? layout.config.callableWrappers.filter((name) => typeof name === 'string') : ['defineCallable'];

  const dirs = functionsDirs(layout, options['functions-dir']).map((entry) => ({ ...entry, dir: cleanDir(entry.dir) }));
  let checked = 0;
  for (const { dir, from } of dirs) {
    const abs = join(layout.root, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new UsageError(`nothing to check: the functions folder ${dir} (${from}) does not exist`, 'Create it from this skill\'s templates (functions/), or point rn-skills.config.json "functionsDir" or --functions-dir at the real folder.');
    }
    if (from !== 'default') report.note(`note: functions folder ${dir} (${from})`);
    const ignore = OUTPUT_DIRS.map((name) => prefixed(dir, `${name}/**`)).concat(['**/*.d.ts']);
    const sources = walkRepo(layout.root, { include: [prefixed(dir, SOURCE_GLOB)], ignore });
    const envFiles = walkRepo(layout.root, { include: [prefixed(dir, '.env'), prefixed(dir, '.env.*')], ignore: [prefixed(dir, '*.local')] });
    if (sources.length === 0) {
      throw new UsageError(`nothing to check: no source files in the functions folder ${dir}`, 'Add functions/src/index.ts from this skill\'s templates.');
    }
    checked += sources.length + envFiles.length;

    const declared = declaredFunctionsVersion(join(abs, 'package.json'));
    const rootIsV1 = declared !== null && declared.major !== null && declared.major < 6;
    const files = sources.map((rel) => {
      const text = readFileSync(join(layout.root, rel), 'utf8');
      return { rel, text, kept: maskComments(text), masked: maskCode(text), lineOf: makeLineOf(text), test: TEST_FILE.test(rel) };
    });

    // Global options and secret params, across the whole functions folder.
    const globalKeys = new Map();
    const secretNames = new Set();
    for (const file of files) {
      for (const call of callsOf(file.masked, 'setGlobalOptions')) {
        const opts = optionsOf(call, file.masked, file.kept);
        if (opts) for (const [key, value] of opts.entries) globalKeys.set(key, value);
      }
      for (const match of file.masked.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*define(?:Json)?Secret\s*\(/g)) secretNames.add(match[1]);
    }

    for (const file of files) {
      const { rel, masked, kept, lineOf } = file;
      const imports = firebaseImports(kept, masked);

      // v1-api
      for (const entry of imports) {
        if (entry.spec === 'firebase-functions/v1' || entry.spec.startsWith('firebase-functions/v1/')) {
          report.problem({ file: rel, line: lineOf(entry.index), rule: 'v1-api', message: `imports ${entry.spec} (1st-gen functions)`, fix: 'Rewrite it as a 2nd-gen function imported from firebase-functions/v2/<trigger> (onCall, onSchedule, onMessagePublished, onDocumentCreated, ...).' });
        } else if (entry.spec === 'firebase-functions' && rootIsV1) {
          report.problem({ file: rel, line: lineOf(entry.index), rule: 'v1-api', message: `imports the root firebase-functions entry point, which is the 1st-gen API in firebase-functions ${declared.spec} (before 6)`, fix: 'Upgrade firebase-functions to the current major and import each trigger from its firebase-functions/v2/<trigger> path.' });
        }
      }
      for (const match of masked.matchAll(V1_SHAPES)) {
        const what = /config/.test(match[0]) ? 'config' : /runWith/.test(match[0]) ? 'runWith' : 'trigger';
        if (what === 'config' && !/^functions\b/.test(match[0])) continue;
        const message = { config: 'functions.config() (removed in firebase-functions 7)', runWith: 'runWith() (1st-gen options)', trigger: `${shapeOf(match[0])} is a 1st-gen trigger shape` }[what];
        const fix = { config: 'Declare the value with defineString / defineSecret from firebase-functions/params.', runWith: 'Pass the options object as the first argument of the 2nd-gen trigger.', trigger: 'Use the 2nd-gen trigger (onSchedule, onMessagePublished, onDocumentCreated, ...) from firebase-functions/v2/<trigger>.' }[what];
        report.problem({ file: rel, line: lineOf(match.index), rule: 'v1-api', message, fix });
      }

      // Trigger and callable sites.
      const triggerCalls = [];
      const reportedDataUses = new Set();
      for (const entry of imports) {
        if ((entry.spec === 'firebase-functions' && rootIsV1) || entry.spec.startsWith('firebase-functions/v1') || NON_TRIGGER_SPECS.has(entry.spec)) continue;
        for (const [local, imported] of entry.names) {
          if (!TRIGGER_NAME.test(imported)) continue;
          for (const call of callsOf(masked, local.replaceAll('$', '\\$'))) triggerCalls.push({ call, name: imported });
        }
        if (entry.namespace) {
          for (const match of masked.matchAll(new RegExp(`(?<![\\w$.])${entry.namespace.replaceAll('$', '\\$')}\\s*\\.\\s*(?:[\\w$]+\\s*\\.\\s*)?(on[A-Z]\\w*|before[A-Z]\\w*)\\s*\\(`, 'g'))) {
            const open = match.index + match[0].length - 1;
            const close = findClosing(masked, open);
            if (close !== -1) triggerCalls.push({ call: { start: match.index, open, close }, name: match[1] });
          }
        }
      }

      for (const { call, name } of triggerCalls) {
        const line = lineOf(call.start);
        const opts = optionsOf(call, masked, kept);
        const own = opts?.entries ?? new Map();
        const missing = LIMIT_KEYS.filter((key) => !own.has(key) && !globalKeys.has(key));
        if (missing.length > 0) {
          report.problem({ file: rel, line, rule: 'unbounded-instances', message: `${name}() has no ${missing.join(', ')} (neither in its options nor in setGlobalOptions)`, fix: 'Set region, maxInstances, timeoutSeconds and memory in setGlobalOptions (imported first by index.ts) and override per function where needed.' });
        }
        if (!CALLABLE_TRIGGERS.has(name)) continue;

        const appCheck = own.has('enforceAppCheck') ? own.get('enforceAppCheck') : globalKeys.get('enforceAppCheck');
        if (!isTrue(appCheck)) {
          report.problem({ file: rel, line, rule: 'missing-app-check', message: opts === null ? `${name}() without an options object: App Check is not enforced` : `${name}() does not set enforceAppCheck: true`, fix: 'Pass { enforceAppCheck: true, ... } as the first argument (or make the callable through the defineCallable wrapper).' });
        }
        if (nonEmptyArray(own.get('secrets')) && !isTrue(own.get('consumeAppCheckToken'))) {
          report.problem({ file: rel, line, rule: 'missing-app-check', message: `${name}() binds a secret (a cost-bearing call) without consumeAppCheckToken: true`, fix: 'Add consumeAppCheckToken: true so one App Check token buys one call, and have the client request limited-use tokens.' });
        }
        if (!AUTH_CHECK.some((re) => re.test(masked))) {
          report.problem({ file: rel, line, rule: 'missing-auth-check', message: `${name}() handler never checks request.auth`, fix: "Return the typed 'unauthenticated' failure when request.auth is undefined, before any work (defineCallable does this)." });
        }
        // request.data must only be read as a parse argument.
        const params = new Set(['request', 'req']);
        const handler = /(?:async\s+)?(?:function\s*[\w$]*\s*)?\(\s*([\w$]+)|(?:async\s+)?([\w$]+)\s*=>/.exec(masked.slice(opts ? opts.end + 1 : call.open + 1, call.close));
        if (handler) params.add(handler[1] ?? handler[2]);
        for (const param of params) {
          for (const match of masked.matchAll(new RegExp(`(?<![\\w$.])${param.replaceAll('$', '\\$')}\\s*\\.\\s*data\\b`, 'g'))) {
            const callee = enclosingCallee(masked, match.index);
            if ((callee !== null && /parse/i.test(callee)) || reportedDataUses.has(match.index)) continue;
            reportedDataUses.add(match.index);
            report.problem({ file: rel, line: lineOf(match.index), rule: 'unvalidated-input', message: `${param}.data is used before it is parsed`, fix: 'Parse it first: const parsed = v.safeParse(Schema, request.data); return invalid-input when it fails, and use only parsed.output.' });
          }
        }
      }

      for (const wrapper of wrappers) {
        for (const call of callsOf(masked, wrapper.replaceAll('$', '\\$'))) {
          const line = lineOf(call.start);
          const opts = optionsOf(call, masked, kept);
          if (opts === null) continue;
          if (opts.entries.has('enforceAppCheck') && !isTrue(opts.entries.get('enforceAppCheck'))) {
            report.problem({ file: rel, line, rule: 'missing-app-check', message: `${wrapper}() turns App Check off`, fix: 'Remove enforceAppCheck from the call; the wrapper enforces it.' });
          }
          if (nonEmptyArray(opts.entries.get('secrets')) && !isTrue(opts.entries.get('consumeAppCheckToken'))) {
            report.problem({ file: rel, line, rule: 'missing-app-check', message: `${wrapper}() binds a secret (a cost-bearing call) without consumeAppCheckToken: true`, fix: 'Add consumeAppCheckToken: true so one App Check token buys one call.' });
          }
          if (!opts.entries.has('input')) {
            report.problem({ file: rel, line, rule: 'unvalidated-input', message: `${wrapper}() has no input schema`, fix: 'Pass input: <valibot schema of the payload>; the wrapper parses it before the handler runs.' });
          }
        }
      }

      // env-secret
      if (!file.test) {
        for (const match of masked.matchAll(/\bprocess\s*\.\s*env\s*(?:\.\s*([\w$]+)|(\[))|\{[^{}]*\}\s*=\s*process\s*\.\s*env\b/g)) {
          const name = match[1];
          if (name !== undefined && !SECRET_WORD.test(name.toUpperCase())) continue;
          report.problem({
            file: rel,
            line: lineOf(match.index),
            rule: 'env-secret',
            message: name !== undefined ? `reads process.env.${name} directly` : match[2] ? 'reads process.env[...] (a name the scan cannot see)' : 'destructures process.env',
            fix: 'Declare it once with defineSecret in config/secrets.ts, bind it on the function that uses it (secrets: [NAME]) and read NAME.value() inside the handler.',
          });
        }
        const localSecrets = new Map();
        for (const name of secretNames) localSecrets.set(name, name);
        for (const match of kept.matchAll(/\bimport\s*\{([^}]*)\}\s*from/g)) {
          for (const part of match[1].split(',')) {
            const [imported, local] = part.trim().split(/\s+as\s+/).map((word) => word.trim());
            if (imported && local && secretNames.has(imported)) localSecrets.set(local, imported);
          }
        }
        for (const [local, declared] of localSecrets) {
          for (const match of masked.matchAll(new RegExp(`(?<![\\w$.])${local.replaceAll('$', '\\$')}\\s*\\.\\s*value\\s*\\(`, 'g'))) {
            const bound = new RegExp(`secrets\\s*:\\s*\\[[^\\]]*(?<![\\w$.])${local.replaceAll('$', '\\$')}(?![\\w$])`).test(masked);
            if (bound) continue;
            report.problem({ file: rel, line: lineOf(match.index), rule: 'env-secret', message: `${declared}.value() in a file whose function does not bind it (no secrets: [${local}])`, fix: `Add ${local} to the secrets option of the function that reads it; an unbound secret is an empty string at runtime.` });
          }
        }
      }

      // literal-key (tests included: a real key in a test is still a leak)
      reportKeys(report, rel, kept, lineOf);
    }

    for (const rel of envFiles) {
      const text = readFileSync(join(layout.root, rel), 'utf8');
      reportKeys(report, rel, text, makeLineOf(text), true);
    }
  }
  return report.finish({ checked, unit: 'files' });
});

/** "document(...).onCreate()" from the matched text of a 1st-gen trigger chain. */
function shapeOf(text) {
  const parts = /\.\s*([\w$]+)\s*\([\s\S]*\.\s*(on[A-Z]\w*)/.exec(text);
  return parts ? `${parts[1]}(...).${parts[2]}()` : 'this trigger';
}

/** The firebase-functions dependency of the functions package: { spec, major } or null. */
function declaredFunctionsVersion(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  const spec = manifest?.dependencies?.['firebase-functions'];
  if (typeof spec !== 'string') return null;
  const major = /(\d+)/.exec(spec);
  return { spec, major: major ? Number(major[1]) : null };
}

function reportKeys(report, rel, text, lineOf, envFile = false) {
  const seen = new Set();
  const add = (index, what) => {
    const line = lineOf(index);
    if (seen.has(line)) return;
    seen.add(line);
    report.problem({ file: rel, line, rule: 'literal-key', message: `${what} is written in the file`, fix: 'Delete it, rotate the key with the provider (it is leaked once committed), and read it through a defineSecret param bound on the function.' });
  };
  for (const { name, re } of KEY_PATTERNS) {
    for (const match of text.matchAll(new RegExp(re.source, 'g'))) add(match.index, name);
  }
  if (envFile) {
    for (const match of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*['"]?([^'"\s#]{16,})/gm)) {
      if (SECRET_WORD.test(match[1].toUpperCase())) add(match.index, `a value for ${match[1]}`);
    }
    return;
  }
  for (const match of text.matchAll(NAMED_SECRET)) {
    if (SECRET_WORD.test(match[1].toUpperCase()) && !/^https?:/.test(match[3]) && /\d/.test(match[3])) add(match.index, `a literal value for ${match[1]}`);
  }
}
