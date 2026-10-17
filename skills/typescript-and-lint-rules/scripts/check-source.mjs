#!/usr/bin/env node
// check-source.mjs: checks TypeScript sources for the code rules that must hold even before
// node_modules exist: no silenced gates, the size limits, erasable syntax only, named exports,
// one alias and no "../" in app code, Node-run files with extensions, the two worlds kept apart,
// synchronous handlers, no dropped promises or swallowed errors, TSDoc on contracts.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-source.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, matchGlob, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { appFiles, appTops, coversAppCode, nativeScope, normalizeIgnore } from './lib/app-scope.mjs';
import { codeLineCount, functionsOf, importsOf, paramListsOf, resolveImport, scanSource } from './lib/source-scan.mjs';

const APP_FIXED = JSON.parse(readFileSync(new URL('../assets/ts-lint-baseline.json', import.meta.url), 'utf8')).appScope.fixed;

const SPEC = {
  name: 'check-source',
  summary:
    'Checks every .ts/.tsx file of the app repo for the rules of the canonical ESLint and tsconfig set that an agent ' +
    'is most likely to break or silence: inline disables, @ts-ignore, the size limits, enum/namespace/interface, ' +
    'default exports, any, parent imports and import extensions, Node-world imports into app code, async handlers, ' +
    'dropped promises, empty catch, console.log, and TSDoc on core functions and port types.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'The app source folder (default: from resolveLayout, "src")' },
    'import-extensions': { type: 'string', value: 'node|all', help: 'Which imports must write the file extension (default: "node"; "all" when multi-package)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (the ESLint rule or tsconfig option each mirrors is in brackets):',
    '  no-inline-config        eslint-disable/-enable, /* eslint */, /* global */ comments   [linterOptions.noInlineConfig]',
    '  no-ts-ignore            @ts-ignore or @ts-nocheck                                   [ban-ts-comment]',
    '  ts-expect-error-reason  @ts-expect-error without a description of 10+ characters    [ban-ts-comment]',
    '  no-warning-comment      a comment starting with TODO, FIXME, XXX or HACK             [no-warning-comments]',
    '  max-lines               more than 250 code lines (400 in tests)                      [max-lines]',
    '  max-lines-per-function  a function over 40 code lines (.ts) or 80 (.tsx); not tests  [max-lines-per-function]',
    '  max-params              more than 3 parameters (functions and function types)        [max-params]',
    '  no-enum                 an enum                                                      [TSEnumDeclaration, erasableSyntaxOnly]',
    '  no-namespace            a namespace or module block outside *.d.ts                   [erasableSyntaxOnly]',
    '  no-interface            an interface outside *.d.ts                                  [consistent-type-definitions]',
    '  no-parameter-property   a constructor parameter property                             [erasableSyntaxOnly]',
    '  no-default-export       export default outside route files, app.config.ts, plugins/, __mocks__/, jest.setup.ts',
    '                                                                                       [import/no-default-export]',
    '  no-explicit-any         the any type                                                 [no-explicit-any]',
    '  no-non-null-assertion   value! outside tests (a definite-assignment field!: T is fine) [no-non-null-assertion]',
    '  no-parent-import        an import from "../" outside Node-run code                   [PARENT_IMPORT]',
    '  import-extension        a relative import in Node-run code (app.config.ts, plugins/, scripts/) without its',
    '                          extension; with --import-extensions all, every relative, @/ or workspace import',
    '                                                                                       [NODE_IMPORT_EXTENSION, PACKAGE_IMPORT_EXTENSION]',
    '  node-world-import       app code (src/) imports a Node built-in, app.config.ts, plugins/ or scripts/,',
    '                          even with import type                                        [two programs, NODE_BUILTINS]',
    '  sync-handler            an async handleX function, an async inline on* handler, or handleSubmit(...)',
    '                          passed straight to an on* prop                               [asyncHandler]',
    '  handler-body            an inline on* arrow or a handleX arrow with an expression body, outside tests',
    '                          (onPress={() => Linking.openURL(url)} returns the promise)    [handlerBody]',
    '  no-void-promise         void task() used to drop a promise, also as an arrow body     [no-floating-promises]',
    '  no-empty-catch          catch {} with nothing inside                                 [no-empty]',
    '  throw-error-object      throw of a string or template literal                        [only-throw-error]',
    '  no-console-log          console.log/info/debug outside Node-run code                 [no-console]',
    '  tsdoc-contract          an exported function or class in src/core, or an exported *Port type, without a',
    '                          one-sentence /** TSDoc */ summary right above it',
    '  ignore-app-code         a PRE_EXISTING entry of eslint.config.mjs reaches app code (src/, test/, __mocks__/,',
    '                          scripts/, plugins/, app.config.ts, layoutEntries); those files are checked anyway',
    '',
    'Scans the repo the way ESLint lints it: generated and native folders, installed skills (any folder holding a',
    'SKILL.md, .agents/, .claude/, skills/) and the PRE_EXISTING entries of eslint.config.mjs are left out (anchored at',
    'the repo root, as ESLint reads them; an entry that reaches app code is reported, not honoured).',
    'Reads from rn-skills.config.json (optional): the layout keys, "importExtensions" ("node" or "all") and',
    '"tsdocGlobs" (repo-relative globs of the files whose exports need TSDoc).',
    'Example: node check-source.mjs .            (from the app repo root)',
  ].join('\n'),
};

const LIMITS = { fileLines: 250, testFileLines: 400, tsFunction: 40, tsxFunction: 80, params: 3 };
const NODE_BUILTINS = new Set(['fs', 'path', 'child_process', 'os', 'crypto', 'http', 'https', 'net']);
// Folders ESLint ignores that the repo walk does not already skip.
const EXTRA_IGNORES = ['expo-env.d.ts', 'reports/**', 'dist-audit/**', '.stryker-tmp/**'];

const any = (rel, globs) => globs.some((glob) => matchGlob(rel, glob));
/** The text before `name!:` on a class-field or let/var declaration line. */
const DEFINITE_ASSIGNMENT = /^\s*(?:(?:private|protected|public|readonly|static|declare|override|accessor)\s+)*#?[A-Za-z_$][\w$]*$|\b(?:let|var)\s+[A-Za-z_$][\w$]*$/;

/** The PRE_EXISTING globs of eslint.config.mjs ({ glob, line }): folders that predate the app and are not linted. */
function preExistingGlobs(root) {
  const path = join(root, 'eslint.config.mjs');
  if (!existsSync(path)) return [];
  const scan = scanSource(readFileSync(path, 'utf8'));
  const match = /const PRE_EXISTING = \[([^\]]*)\]/.exec(scan.code);
  if (!match) return [];
  const from = match.index + match[0].indexOf('[');
  return scan.strings.filter((entry) => entry.index > from && entry.index < match.index + match[0].length).map((entry) => ({ glob: entry.value, line: entry.line }));
}

/**
 * Splits PRE_EXISTING into globs to honour, anchored at the root the way ESLint's flat config reads
 * them ('docs' is the top-level docs/ only), and globs that reach app code: those are reported and
 * not honoured, so the files they name are still checked.
 */
function preExistingIgnores(root, layout, report) {
  const tops = appTops(layout, APP_FIXED);
  const native = nativeScope(root, layout);
  let files = null;
  const honoured = [];
  for (const { glob, line } of preExistingGlobs(root)) {
    files ??= appFiles(root, tops);
    const covers = coversAppCode(glob, { style: 'anchored', tops, files, native });
    if (covers) {
      report.problem({ file: 'eslint.config.mjs', line, rule: 'ignore-app-code', message: `PRE_EXISTING lists '${glob}', which ${covers.reason}; check-source checks those files anyway`, fix: 'Remove it from PRE_EXISTING (and .prettierignore and the root tsconfig.json exclude): app code is always linted. Code the app imports moves under src/ or is declared in rn-skills.config.json "layoutEntries".' });
      continue;
    }
    const clean = normalizeIgnore(glob);
    if (clean !== '') honoured.push(clean.includes('/') ? clean : `${clean}/**`);
  }
  return honoured;
}

/** Which repo paths play which part, from the layout (and each workspace when multi-package). */
function zonesOf(layout) {
  const apps = [{ dir: '', layout }, ...layout.workspaces.map((workspace) => ({ dir: `${workspace.dir}/`, layout: workspace.layout }))];
  const configGlobs = layout.config.tsdocGlobs;
  return {
    app: apps.map((app) => `${app.layout.srcDir}/**`),
    routes: apps.map((app) => `${app.layout.routesDir}/**`),
    node: apps.flatMap((app) => [`${app.dir}app.config.ts`, `${app.dir}plugins/**`, `${app.layout.scriptsDir}/**`]),
    tests: ['**/*.test.ts', '**/*.test.tsx', ...apps.flatMap((app) => [`${app.layout.testDir}/**`, `${app.layout.mocksDir}/**`, `${app.dir}jest.setup.ts`])],
    defaultExport: apps.flatMap((app) => [`${app.layout.routesDir}/**`, `${app.dir}app.config.ts`, `${app.dir}plugins/**`, `${app.layout.mocksDir}/**`, `${app.dir}jest.setup.ts`]),
    tsdoc: Array.isArray(configGlobs) ? configGlobs.map(String) : apps.flatMap((app) => [`${app.layout.coreDir}/**/*.ts`, `${app.layout.servicesDir}/*/*-port.ts`]),
  };
}

/** Text of a comment without its markers, e.g. "eslint-disable-next-line x". */
function commentBody(text) {
  return text.replace(/^\/\/+|^\/\*+|\*+\/$/g, '').replace(/^[\s*]+/, '').trim();
}

function checkComments(rel, scan, report) {
  for (const comment of scan.comments) {
    const body = commentBody(comment.text);
    const at = { file: rel, line: comment.line };
    if (/^(eslint-disable|eslint-enable|eslint-env|eslint\s|globals?\s|exported\s)/.test(body)) {
      report.problem({ ...at, rule: 'no-inline-config', message: `inline ESLint directive "${body.slice(0, 40)}"`, fix: 'Delete it and fix the code; inline config is switched off, and a real exception is a files-scoped block in eslint.config.mjs.' });
    }
    if (/^@ts-(ignore|nocheck)\b/.test(body)) {
      report.problem({ ...at, rule: 'no-ts-ignore', message: `"${body.split(/\s/)[0]}" silences the type checker`, fix: 'Fix the type error; only a wrong third-party type may use @ts-expect-error with a reason.' });
    }
    const expect = /^@ts-expect-error\b[\s:-]*(.*)$/.exec(body);
    if (expect && expect[1].trim().length < 10) {
      report.problem({ ...at, rule: 'ts-expect-error-reason', message: '@ts-expect-error has no description of at least 10 characters', fix: 'Say which third-party type is wrong and why, e.g. "@ts-expect-error: expo-iap 5.8 Purchase type misses revocationDate".' });
    }
    if (/^(todo|fixme|xxx|hack)\b/i.test(body)) {
      report.problem({ ...at, rule: 'no-warning-comment', message: `"${body.slice(0, 30)}" comment`, fix: 'Do the work now or leave it out; nothing comes back to TODO comments and git keeps history.' });
    }
  }
}

function checkSizes(rel, scan, text, isTest, report) {
  const lines = codeLineCount(scan.codeKeep);
  const fileLimit = isTest ? LIMITS.testFileLines : LIMITS.fileLines;
  if (lines > fileLimit) {
    report.problem({ file: rel, line: 1, rule: 'max-lines', message: `${lines} code lines; the limit is ${fileLimit}`, fix: 'Split by responsibility (parsing vs rules vs formatting), never into part-1/part-2 files; move large static data to .json.' });
  }
  if (!isTest) {
    const limit = rel.endsWith('.tsx') ? LIMITS.tsxFunction : LIMITS.tsFunction;
    for (const fn of functionsOf(scan)) {
      if (fn.bodyEnd === -1) continue;
      const count = codeLineCount(scan.codeKeep, text.lastIndexOf('\n', fn.index) + 1, fn.bodyEnd + 1);
      if (count > limit) {
        report.problem({ file: rel, line: fn.line, rule: 'max-lines-per-function', message: `function ${fn.name} has ${count} code lines; the limit is ${limit}`, fix: 'Extract named steps into pure functions or a sub-component; never join lines to fit.' });
      }
    }
  }
  for (const list of paramListsOf(scan)) {
    if (list.params > LIMITS.params) {
      report.problem({ file: rel, line: list.line, rule: 'max-params', message: `${list.name} takes ${list.params} parameters; the limit is ${LIMITS.params}`, fix: 'Pass one readonly options object type named <Function>Options.' });
    }
  }
}

function checkSyntax(rel, scan, kind, report) {
  const { code, lineOf } = scan;
  const hit = (regex, rule, message, fix) => {
    for (const match of code.matchAll(regex)) report.problem({ file: rel, line: lineOf(match.index + match[0].search(/\S/)), rule, message, fix });
  };
  hit(/(?<![\w$.])(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+[A-Za-z_$]/g, 'no-enum', 'enum declaration', "Use an `as const` array and a union: const STATUSES = ['open', 'done'] as const; type Status = (typeof STATUSES)[number].");
  if (!kind.isDts) {
    hit(/(?<![\w$.])(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+[A-Za-z_$][\w$.]*\s*\{/g, 'no-namespace', 'namespace or module block', 'Use plain modules; namespaces are not erasable (only *.d.ts merging may use declare namespace).');
    hit(/(?<![\w$.])(?:export\s+)?(?:declare\s+)?interface\s+[A-Za-z_$]/g, 'no-interface', 'interface declaration', 'Declare it with type; interface is only for declaration merging in *.d.ts files.');
  }
  for (const match of code.matchAll(/\bconstructor\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = code.indexOf(')', open);
    if (/\b(public|private|protected|readonly)\s+[A-Za-z_$]/.test(code.slice(open, close))) {
      report.problem({ file: rel, line: lineOf(match.index), rule: 'no-parameter-property', message: 'constructor parameter property', fix: 'Declare the field and assign it in the constructor body; parameter properties are not erasable.' });
    }
  }
  if (!kind.defaultExportOk) {
    hit(/\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b/g, 'no-default-export', 'default export', 'Export by name (export function x); only Expo Router route files, app.config.ts, config plugins, __mocks__ and jest.setup.ts default-export.');
  }
  for (const match of code.matchAll(/(?<![\w$.])any(?![\w$])/g)) {
    const before = code.slice(Math.max(0, match.index - 12), match.index);
    const after = code.slice(match.index + 3, match.index + 6);
    if (/[:<,|&=[]\s*$|\b(as|extends|keyof|readonly)\s+$/.test(before) && !/^\s*[(:]/.test(after)) {
      report.problem({ file: rel, line: lineOf(match.index), rule: 'no-explicit-any', message: 'the any type', fix: 'Use unknown and narrow it, or name the real type.' });
    }
  }
  if (!kind.isTest) {
    for (const match of code.matchAll(/(?<=[\w$)\]])!(?=[.[)\],;:])(?!=)/g)) {
      // `name!: Type` on a class field or a let/var declarator is a definite-assignment assertion, which
      // no-non-null-assertion does not report.
      const lineStart = code.lastIndexOf('\n', match.index) + 1;
      if (code[match.index + 1] === ':' && DEFINITE_ASSIGNMENT.test(code.slice(lineStart, match.index))) continue;
      report.problem({ file: rel, line: lineOf(match.index), rule: 'no-non-null-assertion', message: 'non-null assertion "!"', fix: 'Handle undefined explicitly (noUncheckedIndexedAccess makes it visible): if (x === undefined) ... or ?? fallback.' });
    }
  }
  // An async inline on* handler, handleSubmit(...) passed straight to an on* prop (react-hook-form returns a
  // promise and rethrows what onValid throws), an async handleX const (also with an arrow-typed annotation)
  // or function.
  hit(/(?<![\w$])on[A-Z][\w$]*=\{\s*async\b|(?<![\w$])on[A-Z][\w$]*=\{\s*(?:[\w$]+\.)?handleSubmit\s*\(|(?<![\w$])(?:const|let)\s+handle[A-Z][\w$]*\s*(?::(?:[^=;]|=>)+)?=\s*async\b|\basync\s+function\s+handle[A-Z]/g, 'sync-handler', 'async event handler', 'Keep the handler synchronous: const handlePress = (): void => { task().catch(reportError); }; for a form, onPress={() => { handleSubmit(onValid)().catch(reportError); }}.');
  // A handler returns nothing: an expression-bodied inline on* arrow or handleX arrow returns what it calls,
  // so onPress={() => Linking.openURL(url)} hands the promise to a prop typed as returning unknown (Strict API).
  if (!kind.isTest) hit(/(?<![\w$])on[A-Z][\w$]*=\{\s*(?:\([^()]*\)|[\w$]+)\s*(?::\s*[^=(){}]+)?=>\s*(?![\s{])|(?<![\w$])(?:const|let)\s+handle[A-Z][\w$]*\s*(?::(?:[^=;]|=>)+)?=\s*(?:async\s*)?(?:\([^()]*\)|[\w$]+)\s*(?::\s*[^=(){};]+)?=>\s*(?![\s{])/g, 'handler-body', 'event handler with an expression body', 'Write a block body that returns nothing: onPress={() => { openLink(url).catch(reportError); }}; no-floating-promises then sees the promise.');
  // A statement, an arrow body (`onPress={() => void save()}`), an argument or a ternary branch.
  hit(/(?:^|=>|\breturn\b|[;{}\n(,?])[ \t]*void\s+[\w$.]+(?:\?\.)?[\w$.]*\s*\(/g, 'no-void-promise', 'void used to drop a promise', 'Await it, return it, or end it with .catch(reportError).');
  hit(/\bthrow\s+['"`]/g, 'throw-error-object', 'throw of a string', "Throw an Error: throw new Error('message', { cause }).");
  if (!kind.isNode) hit(/\bconsole\.(log|info|debug|trace|table|dir)\s*\(/g, 'no-console-log', 'console output in app code', 'Record it through the error-reporting port or show it in the debug menu; only console.warn and console.error are allowed.');
}

function checkEmptyCatch(rel, scan, text, report) {
  for (const match of scan.code.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = scan.code.indexOf('}', open);
    if (close !== -1 && text.slice(open + 1, close).trim() === '') {
      report.problem({ file: rel, line: scan.lineOf(match.index), rule: 'no-empty-catch', message: 'empty catch block', fix: 'Map the error to a Result, record it through the error-reporting port with a fallback, or rethrow with { cause }.' });
    }
  }
}

function checkImports(rel, scan, context, kind, report) {
  const { root, layout, extensionsMode, zones } = context;
  for (const entry of importsOf(scan)) {
    const at = { file: rel, line: entry.line };
    const spec = entry.spec;
    const isRelative = spec.startsWith('./') || spec.startsWith('../');
    if (spec.startsWith('../') && !kind.isNode) {
      report.problem({ ...at, rule: 'no-parent-import', message: `import from "${spec}"`, fix: 'Import a sibling with ./x and any other folder through the alias: @/features/tasks/task-list.' });
    }
    const resolved = resolveImport(rel, spec, { root, aliases: layout.aliases });
    const needsExtension = kind.isNode ? isRelative : extensionsMode === 'all' && resolved.kind === 'local';
    if (needsExtension && !/\.(ts|tsx|json|js|mjs|cjs)$/.test(spec)) {
      const why = kind.isNode ? 'Node type stripping resolves no extensionless relative import' : 'TypeScript-source workspace packages do not resolve without it';
      report.problem({ ...at, rule: 'import-extension', message: `"${spec}" has no file extension`, fix: `Write the extension (./x.ts, ./view.tsx, ./en.json): ${why}.` });
    }
    if (kind.isApp) {
      const builtin = spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0]);
      const nodeFile = resolved.kind === 'local' && resolved.path !== null && any(resolved.path, zones.node);
      if (builtin || nodeFile) {
        const what = builtin ? `the Node built-in "${spec}"` : `the Node-world file ${resolved.path}`;
        report.problem({ ...at, rule: 'node-world-import', message: `app code imports ${what}${entry.typeOnly ? ' (import type still pulls the file into the app program)' : ''}`, fix: 'Move the shared type or pure logic into src/ (a file with no Node imports) and import it from both sides; Node built-ins do not exist in the app runtime.' });
      }
    }
  }
}

/** The /** comment that ends right before `index` (only whitespace between), or null. */
function docCommentBefore(scan, text, index) {
  for (let i = scan.comments.length - 1; i >= 0; i -= 1) {
    const comment = scan.comments[i];
    if (comment.end > index) continue;
    return text.slice(comment.end, index).trim() === '' && comment.text.startsWith('/**') ? comment : null;
  }
  return null;
}

function checkTsdoc(rel, scan, text, report) {
  const fns = functionsOf(scan);
  const pattern = /(^|[;\n}])([ \t]*)export\s+(?:declare\s+)?(?:(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?|const\s+([A-Za-z_$][\w$]*)|type\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))/g;
  for (const match of scan.code.matchAll(pattern)) {
    const at = match.index + match[1].length + match[2].length;
    let what = null;
    if (match[0].includes('function')) what = `function ${match[3] ?? '(default)'}`;
    else if (match[4]) {
      const fn = fns.find((candidate) => candidate.kind === 'arrow' && candidate.name === match[4] && candidate.index > at && !scan.code.slice(at, candidate.index).includes(';'));
      if (fn) what = `function ${match[4]}`;
    } else if (match[5] && /Port$/.test(match[5])) what = `port type ${match[5]}`;
    else if (match[6]) what = `class ${match[6]}`;
    if (what === null || docCommentBefore(scan, text, at)) continue;
    report.problem({ file: rel, line: scan.lineOf(at), rule: 'tsdoc-contract', message: `exported ${what} has no TSDoc summary`, fix: 'Add a one-sentence /** ... */ right above it that states the contract (what it returns, what it never does), not a paraphrase of the code.' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  const configured = options['import-extensions'] ?? layout.config.importExtensions;
  const extensionsMode = configured ?? (layout.mode === 'monorepo' ? 'all' : 'node');
  if (!['node', 'all'].includes(extensionsMode)) fail(`import extensions "${extensionsMode}" is not node or all`, 'Pass --import-extensions node (single app) or all (TypeScript-source workspace packages).');
  const zones = zonesOf(layout);
  const report = createReporter({ name: 'check-source', json: options.json });
  const files = walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: [...EXTRA_IGNORES, ...preExistingIgnores(root, layout, report)] });
  const context = { root, layout, extensionsMode, zones };
  for (const rel of files) {
    const text = readFileSync(join(root, rel), 'utf8');
    const scan = scanSource(text);
    const kind = {
      isTest: any(rel, zones.tests),
      isDts: rel.endsWith('.d.ts'),
      isNode: any(rel, zones.node),
      isApp: any(rel, zones.app),
      defaultExportOk: any(rel, zones.defaultExport),
    };
    checkComments(rel, scan, report);
    checkSizes(rel, scan, text, kind.isTest, report);
    checkSyntax(rel, scan, kind, report);
    checkEmptyCatch(rel, scan, text, report);
    checkImports(rel, scan, context, kind, report);
    if (!kind.isTest && !kind.isDts && any(rel, zones.tsdoc)) checkTsdoc(rel, scan, text, report);
  }
  return report.finish({ checked: files.length, unit: 'TypeScript files' });
});
