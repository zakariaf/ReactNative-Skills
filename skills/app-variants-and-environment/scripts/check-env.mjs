// check-env.mjs: proves that environment variables are used the safe way.
// EXPO_PUBLIC_* values are public (inlined into the JS bundle), app code reads them in one place and
// in the one form Metro inlines, code is included or left out of a bundle only by a literal comparison
// at the require() site, server code stays out of the app, and secrets and variants stay out of
// committed files and out of git. Static scan; zero dependencies.
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createReporter, globToRegExp, maskComments, parseArgs, readProjectConfig, requireDir, resolveLayout, run, toPosix, UsageError } from './check-lib.mjs';
import {
  ALWAYS_INLINED, appCode, CONFIG_FILES, envFilesIn, findFirst, gitignoreRules, insideDir, isFile, isIgnored, isSecretName,
  lineAt, localImportClosure, nameWords, parseDotenv, PUBLIC_PREFIX, readEasJson, resolveAppDir, resolveProfile,
  secretValueKind, VARIANT_ENV,
} from './lib/env-scan.mjs';
import { importsOf, makeLineOf, resolveImport, scanSource } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-env',
  summary: 'Checks how the app uses environment variables: no secret behind an EXPO_PUBLIC_ name or value, process.env read only in src/config/ and only as process.env.EXPO_PUBLIC_* dot access, conditional require() calls decided by a literal comparison at the call, server code kept out of the app, and secrets and variants kept out of eas.json, committed env files and git.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'Folder that holds the app config, eas.json and the .env files, relative to the repo root (default: the root, or the one workspace with an app config)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  public-env-secret  no EXPO_PUBLIC_* variable is named like a secret or holds a secret-looking value',
    '                     (in app code, API routes, src/**/*.d.ts, the app config and the files it imports,',
    '                     env files and eas.json)',
    '  env-reader         app code reads process.env only in src/config/, only as process.env.EXPO_PUBLIC_*',
    '                     (or NODE_ENV/EXPO_OS) with dot access; never brackets, destructuring or other names.',
    "                     A read that decides a require() stays at the call as a literal comparison",
    "                     (process.env.EXPO_PUBLIC_X === 'true' ? require(...) : null). Server code is exempt:",
    '                     API routes (<routes>/**/*+api.ts), server middleware (<routes>/+middleware.ts) and',
    '                     the folders in rn-skills.config.json serverDirs',
    '  variant-reader     app code never reads the variant from Constants.expoConfig.extra',
    '  inclusion-gate     a conditional require() decided by a variant stand-in (a test, debug, dev or',
    '                     variant word, isPreview/IS_STORE_BUILD, __DEV__, a variant-name literal) sits in one',
    "                     ternary with the literal process.env.EXPO_PUBLIC_APP_VARIANT === 'production'; one",
    '                     decided by an imported constant or helper that reads an EXPO_PUBLIC_* value fails',
    '                     too. Debug-bundle tooling behind __DEV__ is not test-only code: Reactotron,',
    '                     why-did-you-render, any package specifier, and rn-skills.config.json devOnlyRequires',
    '  server-import      app code never imports a module from a serverDirs folder',
    '  secret-eas-env     eas.json build env (committed plain text) holds no secret names or values',
    '  secret-env-file    a committed (not git-ignored) env file holds no secret value',
    '  variant-env-file   a committed env file sets no APP_VARIANT or EXPO_PUBLIC_APP_VARIANT value',
    '  secret-ignored     .gitignore covers .env*.local, signing files and every key file eas.json names',
    'rn-skills.config.json keys read: "publicEnvAllow": ["EXPO_PUBLIC_MAPBOX_TOKEN"] lists public names',
    'that look secret but are public by design (say why in the review); "devOnlyRequires":',
    '["./dev-tools/*"] lists require() specifiers (globs) of debug-bundle-only tooling that inclusion-gate',
    'leaves alone; "serverDirs": ["src/server"] lists folders of server-only code (imported by API',
    'routes, never by the app).',
    'App code scanned: srcDir, a routes folder outside it (Expo Router\'s root app/), the app entry',
    '(package.json "main", index.*, App.*) and every local file those import, wherever it lives; with',
    '"srcDir": "." the whole app folder minus Node tooling (*.config.*, *.setup.*, scripts/, test/,',
    '__mocks__/, plugins/). No app code at all is exit 2.',
    'NOT APPLICABLE when package.json has no expo dependency.',
  ].join('\n'),
};

const ASSET_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ttf|otf|woff2?|mp3|wav|m4a|aac|caf|mp4|mov|json|lottie|riv|glb|gltf|db|sqlite|html|txt|md)$/i;
// Whole words (split on camelCase and snake_case) that say a condition stands in for the variant:
// TEST_ONLY, isDebug, devMenuEnabled, APP_VARIANT. Weaker words count only next to a marker word:
// isPreview, IS_STORE_BUILD, productionMode (but not showPreview, releaseNotes, shouldRestore).
const STRONG_WORDS = new Set(['VARIANT', 'DEBUG', 'DEV', 'DEVELOPMENT', 'TEST', 'TESTS', 'TESTING', 'E2E', 'QA', 'STAGING']);
const CONTEXT_WORDS = new Set(['PREVIEW', 'PRODUCTION', 'PROD', 'RELEASE', 'STORE', 'INTERNAL']);
const CONTEXT_MARKERS = new Set(['IS', 'BUILD', 'VARIANT', 'MODE', 'FLAVOR', 'FLAVOUR']);
const VARIANT_LITERALS = new Set(['development', 'preview', 'production', 'staging', 'test']);
// Debug-bundle tooling whose documented gate is __DEV__ (it belongs in Metro debug bundles only).
const DEV_TOOLING = /reactotron|why-did-you-render/i;
const SERVER_ROUTE = /(?:\+api|^\+middleware)\.[cm]?[jt]sx?$/;
const GATE_LITERAL = /process\.env\.EXPO_PUBLIC_APP_VARIANT\s*[!=]==?\s*(['"])(?:development|preview|production)\1|(['"])(?:development|preview|production)\2\s*[!=]==?\s*process\.env\.EXPO_PUBLIC_APP_VARIANT/;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const SIGNING_SAMPLES = [
  { sample: '.env.local', pattern: '.env*.local' },
  { sample: '.env.production.local', pattern: '.env*.local' },
  { sample: 'release.keystore', pattern: '*.keystore' },
  { sample: 'upload.jks', pattern: '*.jks' },
  { sample: 'AuthKey_ABCDE12345.p8', pattern: '*.p8' },
  { sample: 'distribution.p12', pattern: '*.p12' },
  { sample: 'profile.mobileprovision', pattern: '*.mobileprovision' },
];
const GATE_FIX = "Use one ternary: process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : require(<entry>) (the test-only gate). Debug-bundle-only tooling behind __DEV__ goes into rn-skills.config.json devOnlyRequires.";

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const appDir = requireDir(resolve(root, resolveAppDir(root, options['app-dir'])), 'app folder');
  const appRel = (name) => toPosix(relative(root, join(appDir, name)));
  const report = createReporter({ name: 'check-env', json: options.json });
  const manifestPath = isFile(join(appDir, 'package.json')) ? join(appDir, 'package.json') : join(root, 'package.json');
  if (!isFile(manifestPath)) throw new UsageError(`nothing to check: no package.json in ${toPosix(relative(process.cwd(), root)) || '.'}`, 'Run from the app root (the folder with package.json).');
  const manifest = readJson(manifestPath, root);
  if (!{ ...manifest.dependencies, ...manifest.devDependencies }.expo) return report.notApplicable(`expo is not in ${toPosix(relative(root, manifestPath))} dependencies (not an Expo app)`);

  const layout = resolveLayout(root);
  const { publicEnvAllow, devOnlyRequires, serverDirs } = readProjectConfig(root);
  const allow = new Set(Array.isArray(publicEnvAllow) ? publicEnvAllow : []);
  const devOnly = (Array.isArray(devOnlyRequires) ? devOnlyRequires : []).filter((glob) => typeof glob === 'string' && glob !== '').map((glob) => globToRegExp(glob));
  const servers = readServerDirs(serverDirs);
  // App code: srcDir, a routes folder outside it (a root app/), the app entry, and every local file
  // those import (a root components/ folder), so a root-level Expo Router layout is scanned too.
  const { code, declarations, apps, appOf, roots } = appCode(root, layout);
  if (code.length === 0) {
    throw new UsageError(`nothing to check: no app code in ${roots.map((dir) => `${dir}/`).join(', ')} or an app entry (index.ts, App.tsx, package.json "main")`, 'Run from the app root, or name the source folders in rn-skills.config.json ("srcDir": "." when the code sits at the root, "routesDir": "app").');
  }
  const context = {
    report, root, allow, devOnly, servers,
    configDirOf: (rel) => appOf(rel).configDir,
    isConfig: (rel) => apps.some((app) => !['', '.'].includes(app.configDir) && insideDir(rel, app.configDir)),
    // Expo Router API routes and server middleware run on the server, never in the app bundle; so do
    // the folders the app declares in serverDirs (helpers those routes import).
    isServer: (rel) => (apps.some((app) => insideDir(rel, app.routesDir)) && SERVER_ROUTE.test(rel.split('/').at(-1))) || servers.some((dir) => insideDir(rel, dir)),
    resolve: (rel, spec) => resolveImport(rel, spec, { root, aliases: appOf(rel).aliases }),
  };

  for (const rel of code) scanCode(context, rel);
  for (const rel of declarations) scanDeclarations(context, rel);
  const configFiles = scanConfigClosure(context, appDir, new Set([...code, ...declarations]));
  const envFiles = envFilesIn(appDir);
  const rules = gitignoreRules(root, appDir);
  for (const name of envFiles) scanEnvFile({ ...context, rel: appRel(name), rules });
  const easRel = appRel('eas.json');
  const eas = readEasJson(join(root, easRel), easRel);
  if (eas !== null) scanEas({ ...context, eas, easRel });
  checkIgnored({ report, root, rules, eas, appRel, appDir });
  return report.finish({ checked: code.length + declarations.length + configFiles + envFiles.length + (eas ? 1 : 0) + 1, unit: 'files' });
});

function readJson(path, root) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${toPosix(relative(root, path))} is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
}

/** rn-skills.config.json serverDirs: repo-relative folders, or bad input. */
function readServerDirs(value) {
  if (value === undefined) return [];
  const fix = 'Write "serverDirs" as a list of repo-relative folders, for example ["src/server"].';
  if (!Array.isArray(value)) throw new UsageError('rn-skills.config.json "serverDirs" must be a list of folders', fix);
  return value.map((dir) => {
    if (typeof dir !== 'string' || dir.trim() === '' || dir.startsWith('/') || dir.split('/').includes('..')) throw new UsageError(`rn-skills.config.json "serverDirs" entry ${JSON.stringify(dir)} is not a repo-relative folder`, fix);
    return toPosix(dir).replace(/^\.\//, '').replace(/\/+$/, '');
  });
}

/** The statement around `index`: from the previous ; { } at bracket depth 0 to the next one. */
function statementAround(code, index) {
  let depth = 0;
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']') depth += 1;
    else if ((ch === '(' || ch === '[') && depth > 0) depth -= 1;
    else if (ch === '}' && depth > 0) depth += 1;
    else if (ch === '{' && depth > 0) depth -= 1;
    else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) {
      start = i + 1;
      break;
    }
  }
  depth = 0;
  let end = code.length;
  for (let i = index; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth -= 1;
    else if (depth === 0 && (ch === ';' || ch === '}' || ch === ')')) {
      end = i;
      break;
    }
  }
  return { start, end, opener: start > 0 ? code[start - 1] : '' };
}

/**
 * The range of the condition when the `{` at `brace` opens the block of an if (...) or an else
 * ({ start, end } of "(...)" or of "else"), else null.
 */
function ifConditionBefore(code, brace) {
  const head = code.slice(0, brace).trimEnd();
  if (/\belse$/.test(head)) return { start: head.length - 4, end: head.length };
  if (!head.endsWith(')')) return null;
  let depth = 0;
  for (let i = head.length - 1; i >= 0; i -= 1) {
    if (head[i] === ')') depth += 1;
    else if (head[i] === '(') {
      depth -= 1;
      if (depth === 0) return /\bif\s*$/.test(head.slice(0, i)) ? { start: i, end: head.length } : null;
    }
  }
  return null;
}

/** True when the statement around `index` (or the block of the if it conditions) holds a require(). */
function gatesRequire(code, index) {
  const statement = statementAround(code, index);
  if (/\brequire\s*\(/.test(code.slice(statement.start, statement.end))) return true;
  const rest = code.slice(statement.end + 1);
  const open = rest.search(/\S/);
  if (open < 0 || rest[open] !== '{') return false;
  let depth = 0;
  for (let i = open; i < rest.length; i += 1) {
    if (rest[i] === '{') depth += 1;
    else if (rest[i] === '}') {
      depth -= 1;
      if (depth === 0) return /\brequire\s*\(/.test(rest.slice(open, i));
    }
  }
  return false;
}

/** 1-based line of `needle` after the first `anchor` (falls back to the first `needle`). */
function lineAfter(text, anchor, needle) {
  const from = text.indexOf(anchor);
  const index = text.indexOf(needle, from < 0 ? 0 : from);
  return index < 0 ? lineAt(text, needle) : text.slice(0, index).split('\n').length;
}

/** The condition part of a statement: the text after its last assignment "=" and before `offset`. */
function conditionBefore(text, offset) {
  const head = text.slice(0, offset);
  let cut = 0;
  for (const match of head.matchAll(/(?<![=!<>?])=(?![=>])/g)) cut = match.index + 1;
  return head.slice(cut);
}

/** True when a condition (strings masked in `code`, kept in `keep`) stands in for the variant. */
function variantish(code, keep) {
  if (/\b__DEV__\b/.test(code)) return true;
  for (const [, , literal] of keep.matchAll(/(['"`])([A-Za-z]+)\1/g)) if (VARIANT_LITERALS.has(literal)) return true;
  for (const identifier of code.match(IDENTIFIER) ?? []) {
    const words = nameWords(identifier);
    if (words.some((word) => STRONG_WORDS.has(word))) return true;
    if (words.some((word) => CONTEXT_WORDS.has(word)) && words.some((word) => CONTEXT_MARKERS.has(word))) return true;
  }
  return false;
}

/** A literal comparison of process.env.<name> with a string in `text` (either side). */
function literalComparison(name, text) {
  const env = `process\\.env\\.${name}\\b`;
  return new RegExp(`${env}\\s*[!=]==?\\s*(['"])[^'"\\n]*\\1|(['"])[^'"\\n]*\\2\\s*[!=]==?\\s*${env}`).test(text);
}

/**
 * Every conditional require() of a file with its condition: [{ spec, index, ternary, condCode,
 * condKeep, textKeep, ifKeep }]. The condition is the statement's text before the call (after its
 * last assignment) plus the head of the if whose block holds the call.
 */
function conditionalRequires(code, codeKeep) {
  const out = [];
  for (const match of codeKeep.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    const spec = match[2];
    if (ASSET_EXTENSIONS.test(spec)) continue;
    const statement = statementAround(code, match.index);
    const text = code.slice(statement.start, statement.end);
    const textKeep = codeKeep.slice(statement.start, statement.end);
    const ifHead = statement.opener === '{' ? ifConditionBefore(codeKeep, statement.start - 1) : null;
    const ternary = /\?(?![.:])|&&|\|\|/.test(text);
    if (!ternary && ifHead === null) continue;
    const offset = match.index - statement.start;
    const ifCode = ifHead === null ? '' : code.slice(ifHead.start, ifHead.end);
    const ifKeep = ifHead === null ? '' : codeKeep.slice(ifHead.start, ifHead.end);
    out.push({
      spec, index: match.index, ternary: ifHead === null, textKeep, ifKeep,
      condCode: `${conditionBefore(text, offset)} ${ifCode}`, condKeep: `${conditionBefore(textKeep, offset)} ${ifKeep}`,
    });
  }
  return out;
}

/**
 * How a read of process.env.<name> at `index` relates to a require() of the same file:
 *   'gate'    it decides the require in the form Metro strips (the variant: any form, inclusion-gate
 *             judges it; any other name: a literal comparison in the same ternary as the call)
 *   'decides' it decides a require in a form that keeps the module (an if block, a bare truthiness
 *             test, or a const of this file that a require condition uses)
 *   null      it decides no require
 */
function gateRole(code, codeKeep, index, name, requires) {
  if (name === 'EXPO_PUBLIC_APP_VARIANT') return gatesRequire(code, index) ? 'gate' : null;
  const statement = statementAround(code, index);
  if (/\brequire\s*\(/.test(code.slice(statement.start, statement.end))) {
    return literalComparison(name, codeKeep.slice(statement.start, statement.end)) ? 'gate' : 'decides';
  }
  if (gatesRequire(code, index)) return 'decides';
  const declared = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(code.slice(statement.start, index))?.[1];
  if (declared && requires.some((entry) => new RegExp(`(?<![\\w$.])${declared.replace(/\$/g, '\\$')}(?![\\w$])`).test(entry.condCode))) return 'decides';
  return null;
}

/** Value bindings a file imports: Map(local -> { spec, imported: name | 'default' | '*' }). */
function importedBindings(codeKeep) {
  const bindings = new Map();
  for (const match of codeKeep.matchAll(/(?:^|[;\n])\s*import\s+(?!type\b)([^;'"]*?)\s*from\s*(['"])([^'"]+)\2/g)) {
    const [, clause, , spec] = match;
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace) bindings.set(namespace[1], { spec, imported: '*' });
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const part of braces ? braces[1].split(',') : []) {
      const item = part.trim();
      if (item === '' || /^type\s/.test(item)) continue;
      const [imported, local] = item.split(/\s+as\s+/).map((word) => word.trim());
      bindings.set(local ?? imported, { spec, imported });
    }
    const first = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, '').split(',').map((word) => word.trim()).find(Boolean);
    if (first && /^[A-Za-z_$][\w$]*$/.test(first)) bindings.set(first, { spec, imported: 'default' });
  }
  return bindings;
}

/**
 * The code of a declaration from `start`: to ";" at depth 0 (or the end of the enclosing block); a
 * function declaration ends with the block of its body.
 */
function declarationExtent(code, start, { isFunction = false } = {}) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) return code.slice(start, i);
      if (depth === 0 && ch === '}' && isFunction) return code.slice(start, i + 1);
    } else if (ch === ';' && depth === 0) return code.slice(start, i);
  }
  return code.slice(start);
}

/** The EXPO_PUBLIC_ name an exported binding of a module reads, or null (one module, no further hops). */
function envReadOfExport(root, rel, name) {
  let code;
  try {
    code = scanSource(readFileSync(join(root, rel), 'utf8')).code;
  } catch {
    return null;
  }
  let local = name;
  if (name === 'default') {
    const at = /\bexport\s+default\s+/.exec(code);
    if (!at) return null;
    const extent = declarationExtent(code, at.index + at[0].length);
    const own = /^\s*(?:async\s+)?function\b|^\s*\(|^\s*[\w$]+\s*=>/.test(extent) ? null : /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(extent)?.[1];
    if (!own) return /process\s*\.\s*env\s*\.\s*(EXPO_PUBLIC_[A-Za-z0-9_]+)/.exec(extent)?.[1] ?? null;
    local = own;
  } else {
    for (const list of code.matchAll(/\bexport\s*\{([^}]*)\}(?!\s*from)/g)) {
      for (const part of list[1].split(',')) {
        const [inner, outer] = part.trim().split(/\s+as\s+/).map((word) => word.trim());
        if ((outer ?? inner) === name) local = inner;
      }
    }
  }
  const declaration = new RegExp(`(?:^|[;\\n}])\\s*(?:export\\s+)?(?:(?:const|let|var)\\s+${local.replace(/\$/g, '\\$')}\\b|(?:async\\s+)?function\\s*\\*?\\s*${local.replace(/\$/g, '\\$')}\\s*\\()`).exec(code);
  if (!declaration) return null;
  const isFunction = declaration[0].endsWith('(');
  const extent = declarationExtent(code, declaration.index + declaration[0].length - (isFunction ? 1 : 0), { isFunction });
  return /process\s*\.\s*env\s*\.\s*(EXPO_PUBLIC_[A-Za-z0-9_]+)/.exec(extent)?.[1] ?? null;
}

/** The first identifier of a require condition that is imported from a local module reading EXPO_PUBLIC_*. */
function envDerivedBinding(context, rel, condCode, bindings) {
  for (const match of condCode.matchAll(IDENTIFIER)) {
    const binding = bindings.get(match[0]);
    if (!binding || condCode[match.index - 1] === '.') continue;
    let imported = binding.imported;
    if (imported === '*') {
      imported = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(condCode.slice(match.index + match[0].length))?.[1];
      if (!imported) continue;
    }
    const target = context.resolve(rel, binding.spec);
    if (target.kind !== 'local' || !target.exists) continue;
    const env = envReadOfExport(context.root, target.path, imported);
    if (env) return { name: match[0], path: target.path, env };
  }
  return null;
}

function scanCode(context, rel) {
  const { report, root, allow } = context;
  const source = readFileSync(join(root, rel), 'utf8');
  const scan = scanSource(source);
  const lineOf = makeLineOf(source);
  const { code, codeKeep } = scan;
  const server = context.isServer(rel);
  const requires = conditionalRequires(code, codeKeep);
  // process.env reads
  for (const match of code.matchAll(/\bprocess\s*\.\s*env\b/g)) {
    const after = code.slice(match.index + match[0].length);
    const dot = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(after);
    const line = lineOf(match.index);
    // Server code reads the real process.env at request time: every form works there, and secrets
    // belong there (EAS environment variables, eas deploy --environment).
    if (/^\s*\??\.?\s*\[/.test(after)) {
      if (!server) report.problem({ file: rel, line, rule: 'env-reader', message: 'process.env[...] is not a supported form: Expo inlines only dot access, so a computed name is undefined in a release build', fix: 'Read the variable with dot access in src/config/ (process.env.EXPO_PUBLIC_NAME).' });
      continue;
    }
    if (!dot) {
      if (!server) report.problem({ file: rel, line, rule: 'env-reader', message: 'process.env used as an object (destructured, spread or passed on): only process.env.EXPO_PUBLIC_NAME is inlined', fix: 'Read each variable as process.env.EXPO_PUBLIC_NAME in src/config/.' });
      continue;
    }
    const name = dot[1];
    if (ALWAYS_INLINED.includes(name)) continue;
    if (!name.startsWith(PUBLIC_PREFIX)) {
      if (!server) report.problem({ file: rel, line, rule: 'env-reader', message: `process.env.${name} is not an EXPO_PUBLIC_ variable: it is undefined in a release build (Jest still sees it, so tests pass)`, fix: `App code gets only EXPO_PUBLIC_* values; build-time values stay in app.config.ts or the build environment, and a value the app needs at run time from a secret comes from a server (an Expo Router API route reads it from process.env). If ${rel} is server-only code that only API routes import, list its folder in rn-skills.config.json "serverDirs".` });
      continue;
    }
    if (isSecretName(name) && !allow.has(name)) {
      report.problem({ file: rel, line, rule: 'public-env-secret', message: `${name} is named like a secret, but every EXPO_PUBLIC_ value is inlined into the JS bundle and readable by anyone`, fix: server ? `Drop the EXPO_PUBLIC_ prefix: server code reads ${name.slice(PUBLIC_PREFIX.length)} from its own environment (eas env:set --visibility sensitive, then eas deploy --environment <e>).` : 'Call your server instead (an Expo Router API route reads the key from process.env), or keep it in EAS secret variables for build steps; if it is public by design, list it in rn-skills.config.json publicEnvAllow.' });
    }
    if (server || context.isConfig(rel)) continue;
    const role = gateRole(code, codeKeep, match.index, name, requires);
    if (role === 'gate') continue;
    if (role === 'decides') {
      report.problem({ file: rel, line, rule: 'env-reader', message: `process.env.${name} decides whether a require() is in the bundle, but not as a literal comparison in the same ternary: Metro strips a module only when the comparison folds where the call is`, fix: `Keep the literal comparison at the require site: process.env.${name} === '<value>' ? require(<entry>) : null (an imported constant or a separate const does not strip code, verified on SDK 57).` });
      continue;
    }
    const configDir = context.configDirOf(rel);
    report.problem({ file: rel, line, rule: 'env-reader', message: `process.env.${name} read outside ${configDir}/: environment values have one reader`, fix: `Read it in ${configDir}/ (currentAppVariant() for the variant, a typed environment module for the rest) and import that.` });
  }
  // the variant from expo-constants
  for (const match of codeKeep.matchAll(/\bextra\s*\??\.\s*appVariant\b|\bextra\s*\??\.?\s*\[\s*['"]appVariant['"]\s*\]/g)) {
    report.problem({ file: rel, line: lineOf(match.index), rule: 'variant-reader', message: 'the variant is read from Constants.expoConfig.extra: a second source of truth beside the inlined EXPO_PUBLIC_APP_VARIANT', fix: 'Call currentAppVariant() from src/config/current-app-variant.ts.' });
  }
  checkInclusion(context, rel, { code, codeKeep, lineOf, requires });
  if (!server && context.servers.length > 0) checkServerImports(context, rel, scan);
}

/** inclusion-gate: what decides a conditional require() must fold where the call is. */
function checkInclusion(context, rel, { codeKeep, lineOf, requires }) {
  const { report } = context;
  let bindings = null;
  for (const entry of requires) {
    const { spec, condCode, condKeep } = entry;
    // Debug-bundle tooling (Reactotron's documented `if (__DEV__) require(...)`) is not test-only code.
    if (DEV_TOOLING.test(spec) || context.devOnly.some((re) => re.test(spec))) continue;
    if (context.resolve(rel, spec).kind === 'external' && /\b__DEV__\b/.test(condCode)) continue;
    const line = lineOf(entry.index);
    if (variantish(condCode, condKeep)) {
      if (entry.ternary && GATE_LITERAL.test(entry.textKeep)) continue;
      if (!entry.ternary && GATE_LITERAL.test(entry.ifKeep)) {
        report.problem({ file: rel, line, rule: 'inclusion-gate', message: `the require() of ${spec} sits in an if block: use the ternary gate form, the only form the gate file, its lint exemption and the bundle proof cover`, fix: GATE_FIX });
      } else {
        report.problem({ file: rel, line, rule: 'inclusion-gate', message: `the require() of ${spec} is not decided by the literal variant comparison in one expression: an imported constant or a helper call keeps the module in production bundles (verified on SDK 57), and __DEV__ also drops it from preview builds`, fix: GATE_FIX });
      }
      continue;
    }
    // Any other public value that decides inclusion must fold at the call too (a Storybook flag).
    bindings ??= importedBindings(codeKeep);
    const derived = envDerivedBinding(context, rel, condCode, bindings);
    if (derived) {
      report.problem({ file: rel, line, rule: 'inclusion-gate', message: `the require() of ${spec} is decided by ${derived.name}, imported from ${derived.path}, which reads process.env.${derived.env}: Metro folds only a literal comparison written at the call, so the module ships in every bundle (verified on SDK 57)`, fix: `Compare the variable with its literal at the require site: process.env.${derived.env} === '<value>' ? require(${spec}) : null.` });
    }
  }
}

/** server-import: app code never imports a module from a serverDirs folder. */
function checkServerImports(context, rel, scan) {
  for (const entry of importsOf(scan)) {
    if (entry.typeOnly) continue;
    const target = context.resolve(rel, entry.spec);
    if (target.kind !== 'local' || !target.exists || !context.isServer(target.path)) continue;
    context.report.problem({ file: rel, line: entry.line, rule: 'server-import', message: `imports ${entry.spec} (${target.path}), which sits in a serverDirs folder: its server code (and its secret reads) would be bundled into the app, where process.env holds no secrets`, fix: 'Call the server through an API route (the ApiClient does) instead of importing server code; move code both sides need out of the server folder.' });
  }
}

function scanDeclarations(context, rel) {
  const { report, root, allow } = context;
  const source = readFileSync(join(root, rel), 'utf8');
  const lineOf = makeLineOf(source);
  for (const match of source.matchAll(/\b(EXPO_PUBLIC_[A-Z0-9_]+)\b/g)) {
    if (isSecretName(match[1]) && !allow.has(match[1])) {
      report.problem({ file: rel, line: lineOf(match.index), rule: 'public-env-secret', message: `${match[1]} is declared as a public variable but is named like a secret`, fix: 'Rename it if it is public by design (or list it in rn-skills.config.json publicEnvAllow); otherwise remove it: secrets never reach the app.' });
    }
  }
}

/**
 * The app config and the local files it imports (outside the scanned source): an EXPO_PUBLIC_ secret
 * name there means the value sits in a public variable of every build environment. Returns the number
 * of files read.
 */
function scanConfigClosure(context, appDir, scanned) {
  const { report, root, allow } = context;
  const configName = findFirst(appDir, CONFIG_FILES);
  if (configName === null) return 0;
  const appPrefix = toPosix(relative(root, appDir));
  const closure = localImportClosure(appDir, configName).map((file) => (appPrefix === '' ? file : `${appPrefix}/${file}`)).filter((rel) => !scanned.has(rel));
  for (const rel of closure) {
    const source = maskComments(readFileSync(join(root, rel), 'utf8'));
    const lineOf = makeLineOf(source);
    const seen = new Set();
    for (const match of source.matchAll(/\b(EXPO_PUBLIC_[A-Za-z0-9_]+)\b/g)) {
      const name = match[1];
      if (seen.has(name) || !isSecretName(name) || allow.has(name)) continue;
      seen.add(name);
      report.problem({ file: rel, line: lineOf(match.index), rule: 'public-env-secret', message: `${name} is named like a secret, but an EXPO_PUBLIC_ variable is public: any app code that reads it inlines the value, and EAS shows it in plain text`, fix: `Drop the EXPO_PUBLIC_ prefix and keep the value in an EAS secret variable (eas env:set --name ${name.slice(PUBLIC_PREFIX.length)} --visibility secret); the config passes nothing secret into the app.` });
    }
  }
  return closure.length;
}

function scanEnvFile({ report, root, allow, rel, rules }) {
  const text = readFileSync(join(root, rel), 'utf8');
  const committed = rules === null || !isIgnored(rules, rel);
  for (const { name, value, line } of parseDotenv(text)) {
    if (VARIANT_ENV.includes(name)) {
      if (committed && value !== '') report.problem({ file: rel, line, rule: 'variant-env-file', message: `${rel} sets ${name}=${value}, and git would commit it: Expo CLI loads env files for start, export and prebuild, so every local run builds that variant`, fix: `Delete the line (keep it commented as documentation): the variant comes from the command, the eas.json profile or the EAS environment, never from a committed file.` });
      continue;
    }
    const kind = secretValueKind(value);
    if (name.startsWith(PUBLIC_PREFIX)) {
      if ((isSecretName(name) && !allow.has(name)) || kind) {
        report.problem({ file: rel, line, rule: 'public-env-secret', message: `${name} ${kind ? `holds ${kind.what}` : 'is named like a secret'}, and EXPO_PUBLIC_ values are inlined into the JS bundle`, fix: 'Move the secret to an EAS secret variable used only by build steps (or to your server); rotate it if it shipped.' });
      }
      continue;
    }
    if (committed && value !== '' && (isSecretName(name) || kind)) {
      report.problem({ file: rel, line, rule: 'secret-env-file', message: `${name} has a value in ${rel}, which git would commit${kind ? ` (${kind.what})` : ''}`, fix: `Empty it here and keep the value in .env.local (git-ignored) or in EAS secret variables; rotate it if it was ever committed.` });
    }
  }
}

function scanEas({ report, allow, eas, easRel }) {
  const build = eas.data?.build && typeof eas.data.build === 'object' ? eas.data.build : {};
  for (const name of Object.keys(build)) {
    const profile = build[name];
    const blocks = [['env', profile?.env], ['ios.env', profile?.ios?.env], ['android.env', profile?.android?.env]];
    for (const [where, env] of blocks) {
      for (const [key, value] of Object.entries(env && typeof env === 'object' ? env : {})) {
        const kind = secretValueKind(typeof value === 'string' ? value : '');
        const line = lineAfter(eas.text, `"${name}"`, `"${key}"`);
        if (key.startsWith(PUBLIC_PREFIX)) {
          if ((isSecretName(key) && !allow.has(key)) || kind) report.problem({ file: easRel, line, rule: 'public-env-secret', message: `build.${name}.${where}.${key} ${kind ? `holds ${kind.what}` : 'is named like a secret'}, and EXPO_PUBLIC_ values are inlined into the JS bundle`, fix: 'Keep secrets out of the app; build steps read them from EAS secret variables.' });
        } else if (isSecretName(key) || kind) {
          report.problem({ file: easRel, line, rule: 'secret-eas-env', message: `build.${name}.${where}.${key} puts a secret into eas.json, which is committed plain text`, fix: `Delete it from eas.json and create it with: eas env:set --name ${key} --visibility secret --environment ${['development', 'preview', 'production'].includes(name) ? name : '<environment>'}` });
        }
      }
    }
  }
}

function checkIgnored({ report, root, rules, eas, appRel, appDir }) {
  if (rules === null) {
    report.problem({ file: '.gitignore', line: 0, rule: 'secret-ignored', message: 'no .gitignore: local env files, keystores and store keys would be committed', fix: 'Add a .gitignore with at least .env*.local, *.keystore, *.jks, *.p8, *.p12 and *.mobileprovision.' });
    return;
  }
  const needs = SIGNING_SAMPLES.map(({ sample, pattern }) => ({ rel: appRel(sample), pattern, why: 'local secrets and signing material' }));
  const build = eas?.data?.build && typeof eas.data.build === 'object' ? eas.data.build : {};
  if (Object.keys(build).some((name) => resolveProfile(build, name).profile?.credentialsSource === 'local')) {
    needs.push({ rel: appRel('credentials.json'), pattern: 'credentials.json', why: 'a build profile uses credentialsSource "local" (keystore and certificate passwords)' });
  }
  for (const [name, profile] of Object.entries(eas?.data?.submit && typeof eas.data.submit === 'object' ? eas.data.submit : {})) {
    for (const [platform, key] of [['android', 'serviceAccountKeyPath'], ['ios', 'ascApiKeyPath']]) {
      const path = profile?.[platform]?.[key];
      if (typeof path !== 'string' || path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:/.test(path)) continue;
      const rel = toPosix(relative(root, resolve(appDir, path)));
      if (rel.startsWith('..')) continue;
      needs.push({ rel, pattern: rel, why: `eas.json submit.${name}.${platform}.${key} points at it` });
    }
  }
  const seen = new Set();
  for (const need of needs) {
    if (seen.has(need.pattern) || isIgnored(rules, need.rel)) continue;
    seen.add(need.pattern);
    report.problem({ file: '.gitignore', line: 0, rule: 'secret-ignored', message: `${need.rel} is not git-ignored (${need.why})`, fix: `Add the line ${need.pattern} to .gitignore.` });
  }
}
