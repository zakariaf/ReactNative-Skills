#!/usr/bin/env node
// check-error-spine.mjs: proves the Result/failure spine of a React Native app holds where ESLint and
// tsc cannot see it: one Result module, failures that are kind unions (no text, no Error), catches
// that handle, rethrows with a cause, adapters that convert at the boundary, Results never dropped,
// no error.message in the UI, failure-message keys that exist, and no destructive error paths.
// Usage: node check-error-spine.mjs [repo-root] [options]   (see --help)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, notYetCreated, parseArgs, resolveLayout, run } from './check-lib.mjs';
import {
  callArgs,
  catchBlocks,
  failureBranches,
  hasMarker,
  isEmptyExpression,
  isHandledBody,
  isHandledExpression,
  promiseCatches,
  readAppSources,
  readPackageJson,
  repoDependsOn,
  tryBlocks,
} from './lib/error-scan.mjs';
import { importsOf, matchBracket, resolveImport } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-error-spine',
  summary:
    'Checks the Result/failure spine of a React Native app: one Result module, failures as kind unions without text, catches that handle and rethrow with a cause, adapters that convert at the boundary, no dropped Result, no error.message in the UI, failure-message keys in the catalog, no destructive error paths.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout, src)' },
    'result-module': {
      type: 'string',
      value: 'file',
      help: 'The Result module (default: rn-skills.config.json "resultModule", else <coreDir>/result.ts)',
    },
    catalog: {
      type: 'string',
      value: 'file',
      help: 'Source-language catalog for failure-message keys (default: rn-skills.config.json "sourceCatalog", else <i18nDir>/catalogs/en.json)',
    },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  result-module            the Result module (src/core/result.ts) exists and exports Result (discriminated on ok), ok and err',
    '  single-result            no second Result/Either type and no result library (neverthrow, fp-ts Either, ...)',
    '  failure-shape            err() gets a failure object, never a string, number, Error, null or undefined; a Result error type that is',
    '                           (or has a union member that is) string, Error, unknown, any, object, null, undefined or void, or a literal union',
    '  failure-text             no UI text in a failure: err({ message|title|text|label|description: <literal or t()> }), any other value',
    '                           that reads as a sentence (reason: \'This task is locked.\'), or a message field in a *Failure type',
    '  catch-handled            a catch / .catch handler throws, calls err(...) or passes the caught error on (to a call, or returned/assigned);',
    '                           console.* and logger.debug/trace/verbose calls do not count, so catch { return null; } and a console-only catch fail',
    '                           (a throw that is the expected answer, as in a validator or a probe, is converted with attempt(...) instead)',
    '                           (a "// best-effort: <reason>" comment licenses an ignored failure in a *-adapter.ts file only)',
    '  rethrow-cause            throw new Error(...) inside a catch passes { cause }',
    '  adapter-boundary         every await in src/services/<concern>/*-adapter.ts sits in try/catch, awaits attemptAsync/withTimeout,',
    '                           or sits inside the arguments of an attemptAsync(...)/withTimeout(...) call (its task callback)',
    '  result-ignored           a call to a function that returns Result is not a bare statement (also after case:, if (...), for (...),',
    '                           while (...), else), the body of an arrow handed to forEach, or an on* arrow body; a call without a',
    '                           receiver counts only for a function the file declares or imports from its declaring file (never one the',
    '                           file binds itself); a call on a receiver only when the receiver holds the owning type (annotated, created,',
    '                           named like it) or is a namespace import of the declaring module',
    '  ui-error-message         no error.message / String(error) / ${error} in .tsx files and src/features/**/use-*.ts, except as the',
    '                           key t(...) or formatMessage({ id }) translates (a schema message that is a catalog key)',
    '  failure-message-key      every value of a Record<XFailure[\'kind\'], ...> table is a key of the source catalog',
    '  no-destructive-recovery  no delete/drop/clear/reset/remove in a catch, a .catch handler or a failure branch',
    'NOT APPLICABLE when package.json lists no react-native. Exit 2 when package.json or the source folder is missing.',
    'SKIP <catalog> [failure-message-key] when the catalog is not yet created (i18n-strings-and-catalogs creates it).',
  ].join('\n'),
};

const RESULT_LIBRARIES = [
  'neverthrow', 'ts-results', 'ts-results-es', 'true-myth', 'fp-ts/Either', 'fp-ts/lib/Either', 'fp-ts/TaskEither',
  'oxide.ts', '@badrap/result', 'purify-ts', 'option-t', 'typescript-result', 'better-result', 'effect',
];
// In an err({ ... }) literal, these keys with a literal (or t()) value are UI text. In a *Failure type
// only the message-like names count: title, text or label may be the user's data (a task's title).
const TEXT_KEYS = 'message|title|text|label|description|userMessage|displayMessage|errorMessage|localizedMessage';
const TYPE_TEXT_KEYS = 'message|userMessage|displayMessage|errorMessage|localizedMessage';
const BAD_ERROR_TYPES = /^(string|String|Error|TypeError|RangeError|SyntaxError|unknown|any|object|\{\s*\}|null|undefined|void)$/;
const DESTRUCTIVE = [
  /\bdeleteDatabase(?:Sync|Async)?\s*\(/,
  /\.\s*(?:clear|clearAll\w*)\s*\(/,
  /\bremoveItem(?:Async)?\s*\(/,
  /\bdeleteItemAsync\s*\(/,
  /\.\s*deleteAsync\s*\(/,
  /\.\s*delete\s*\(\s*\)/,
  /\breset(?:[A-Z]\w*)?\s*\(/,
  /\b(?:wipe|purge)\w*\s*\(/,
];
const DESTRUCTIVE_SQL = /\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i;

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const report = createReporter({ name: SPEC.name, json: options.json });
  const pkg = readPackageJson(root);
  if (pkg === null) fail(`no package.json in ${root}`, 'Pass the app repo root (the folder with package.json).');
  if (pkg.invalid) fail(`package.json in ${root} is not valid JSON`, 'Fix package.json, then rerun.');
  if (!repoDependsOn(root, pkg, 'react-native')) return report.notApplicable('react-native is not in package.json');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  if (!existsSync(join(root, layout.srcDir))) fail(`nothing to check: ${layout.srcDir}/ does not exist`, 'Pass the app repo root, or --src-dir <dir>.');
  const files = readAppSources(root, layout.srcDir);
  const resultRel = options['result-module'] ?? layout.config?.resultModule ?? `${layout.coreDir}/result.ts`;
  const app = files.filter((file) => !file.isTest);
  checkResultModule(root, resultRel, report);
  for (const file of app) {
    if (file.rel !== resultRel) checkSingleResult(file, report);
    checkFailureShape(file, report);
    checkFailureText(file, report);
    checkCatches(file, report);
    checkDestructiveRecovery(file, report);
    if (isAdapter(file.rel, layout)) checkAdapterBoundary(file, report);
    if (isUiFile(file.rel, layout)) checkUiErrorMessage(file, report);
  }
  checkIgnoredResults(app, root, layout, report);
  checkFailureMessageKeys(root, app, layout, options, report);
  return report.finish({ checked: files.length, unit: 'source files' });
}

// --- result-module, single-result ---------------------------------------------------------------

function checkResultModule(root, rel, report) {
  const fix = 'Copy templates/src/core/result.ts from the error-handling-typed-results skill.';
  if (!existsSync(join(root, rel))) {
    report.problem({ file: rel, line: 1, rule: 'result-module', message: 'the app has no Result module', fix });
    return;
  }
  const code = readFileSync(join(root, rel), 'utf8').replace(/\/\/.*$/gm, '');
  const wants = [
    [/export\s+type\s+Result\s*</, 'export type Result<TValue, TError>'],
    [/\bok\s*:\s*true\b[\s\S]*\bok\s*:\s*false\b/, 'the union { ok: true; value } | { ok: false; error }'],
    [/export\s+function\s+ok\s*</, 'export function ok'],
    [/export\s+function\s+err\s*</, 'export function err'],
  ];
  for (const [pattern, what] of wants) {
    if (!pattern.test(code)) report.problem({ file: rel, line: 1, rule: 'result-module', message: `missing ${what}`, fix });
  }
}

function checkSingleResult(file, report) {
  const { scan, rel } = file;
  for (const match of scan.code.matchAll(/\b(?:type|interface|class)\s+(Result|Either)\s*</g)) {
    report.problem({ file: rel, line: scan.lineOf(match.index), rule: 'single-result', message: `a second ${match[1]} type`, fix: "Import Result, ok and err from '@/core/result' (one shape across the app)." });
  }
  for (const entry of importsOf(scan)) {
    if (RESULT_LIBRARIES.some((name) => entry.spec === name || entry.spec.startsWith(`${name}/`))) {
      report.problem({ file: rel, line: entry.line, rule: 'single-result', message: `imports the result library ${entry.spec}`, fix: "Use '@/core/result'; mixing two Result shapes forces adapters between them." });
    }
  }
}

// --- failure-shape, failure-text ----------------------------------------------------------------

function checkFailureShape(file, report) {
  const { scan, rel } = file;
  const { code } = scan;
  for (const match of code.matchAll(/(?<![\w$.])err\s*\(/g)) {
    const at = match.index + match[0].length;
    const rest = code.slice(at).trimStart();
    let what = null;
    if (/^['"`]/.test(rest)) what = 'a string';
    else if (/^-?\d/.test(rest)) what = 'a number';
    else if (/^new\s+(?:[A-Z]\w*)?Error\b/.test(rest)) what = 'an Error object';
    else if (/^(?:null|undefined|void\s+0)\s*\)/.test(rest)) what = 'no failure (null or undefined)';
    if (what) report.problem({ file: rel, line: scan.lineOf(match.index), rule: 'failure-shape', message: `err() gets ${what}`, fix: "Return a failure object: err({ kind: 'task-not-found', taskId })." });
  }
  for (const match of code.matchAll(/(?<![\w$.])Result\s*</g)) {
    const args = typeArguments(code, match.index + match[0].length - 1);
    const second = args[1]?.trim();
    if (second === undefined) continue;
    const literalUnion = /^(['"`])\s*\1(\s*\|\s*(['"`])\s*\3)*$/.test(second);
    const bad = literalUnion ? null : unionMembers(second).find((member) => BAD_ERROR_TYPES.test(member));
    if (bad !== undefined) {
      const shown = literalUnion ? 'a string-literal union' : bad === second ? second : `a union with ${bad} in it`;
      report.problem({ file: rel, line: scan.lineOf(match.index), rule: 'failure-shape', message: `Result error type is ${shown}`, fix: "Type the error as a kind union: { readonly kind: 'task-not-found'; readonly taskId: string } | ..." });
    }
  }
}

/** The members of a union type at depth 0: `string | Error` -> ['string', 'Error'] (a leading "|" allowed). */
function unionMembers(type) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < type.length; i += 1) {
    const ch = type[i];
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if ((ch === '>' && type[i - 1] !== '=') || ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === '|' && depth === 0) {
      out.push(type.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(type.slice(start).trim());
  return out.filter((member) => member !== '');
}

/** Top-level type arguments of the "<" at `open` (strings are blanked in code). */
function typeArguments(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === '>' && code[i - 1] !== '=') {
      depth -= 1;
      if (depth === 0) {
        args.push(code.slice(start, i));
        return args;
      }
    } else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 1) {
      args.push(code.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) return [];
  }
  return [];
}

function checkFailureText(file, report) {
  const { scan, rel } = file;
  const { code } = scan;
  const textProp = new RegExp(String.raw`(?:^|[{,])\s*(${TEXT_KEYS})\s*:\s*(['"\x60]|t\s*\(|\w+\.formatMessage\s*\()`, 'g');
  for (const match of code.matchAll(/(?<![\w$.])err\s*\(\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);
    if (close === -1) continue;
    const body = topLevelOnly(code.slice(open + 1, close));
    const named = new Set();
    for (const prop of body.matchAll(textProp)) {
      named.add(open + 1 + prop.index);
      report.problem({ file: rel, line: scan.lineOf(open + 1 + prop.index), rule: 'failure-text', message: `the failure carries UI text (${prop[1]})`, fix: 'Keep the failure kind + typed params; the screen maps the kind to a message key.' });
    }
    // Any other key whose literal value reads as a sentence: { kind, reason: 'This task is locked.' }.
    for (const prop of body.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:\s*(['"\x60])/g)) {
      if (prop[1] === 'kind' || named.has(open + 1 + prop.index)) continue;
      const literal = scan.stringAt.get(open + 1 + prop.index + prop[0].length - 1);
      if (!literal || !readsAsProse(literal.value)) continue;
      report.problem({ file: rel, line: literal.line, rule: 'failure-text', message: `the failure carries UI text (${prop[1]}: a sentence)`, fix: 'Keep the failure kind + typed params (codes, ids, limits); the screen maps the kind to a message key.' });
    }
  }
  for (const match of code.matchAll(/\btype\s+([A-Z]\w*Failure)\b[^=;]*=/g)) {
    const end = declarationEnd(code, match.index + match[0].length);
    const region = code.slice(match.index, end);
    for (const prop of region.matchAll(new RegExp(String.raw`(?:readonly\s+)?\b(${TYPE_TEXT_KEYS})\??\s*:`, 'g'))) {
      report.problem({ file: rel, line: scan.lineOf(match.index + prop.index), rule: 'failure-text', message: `${match[1]} has a ${prop[1]} field (UI text in a failure)`, fix: 'Carry codes and typed params (taskId, limit); localize from the kind at the edge.' });
    }
  }
}

/**
 * True when a literal reads as a sentence for people, not a code: it has a space and ends in . ! ? or
 * starts with a capitalised word followed by more words ('This task is locked', 'Could not save.').
 * 'unique', 'tasks.title' and 'not-found' stay codes.
 */
function readsAsProse(value) {
  const text = value.trim();
  if (!/\s/.test(text)) return false;
  return /[.!?\u2026]$/.test(text) || /^[A-Z][a-z']+\s+[A-Za-z]/.test(text);
}

/** The text with the inside of every nested { } / ( ) / [ ] blanked (the brackets kept), so only top-level entries remain. */
function topLevelOnly(text) {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    const isOpen = ch === '{' || ch === '(' || ch === '[';
    const isClose = ch === '}' || ch === ')' || ch === ']';
    if (isClose) depth -= 1;
    const isVisible = depth === 0 || ch === '\n';
    out += isVisible ? ch : ' ';
    if (isOpen) depth += 1;
  }
  return out;
}

/** Index of the ";" that ends a type alias starting at `from` (depth 0), or the end of the code. */
function declarationEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth += 1;
    else if ((ch === '}' || ch === ')' || ch === ']' || ch === '>') && code[i - 1] !== '=') depth -= 1;
    else if (ch === ';' && depth <= 0) return i;
  }
  return code.length;
}

// --- catch-handled, rethrow-cause -------------------------------------------------------------

const BEST_EFFORT = 'best-effort:';

function checkCatches(file, report) {
  const { scan, rel, text } = file;
  const adapter = /-adapter\.tsx?$/.test(rel);
  const licensed = (from, to, line) => {
    if (!hasMarker(text, from, to, BEST_EFFORT)) return false;
    if (adapter) return true;
    report.problem({ file: rel, line, rule: 'catch-handled', message: 'a best-effort marker outside an adapter', fix: 'Only a *-adapter.ts may ignore a cosmetic failure; elsewhere map, record or rethrow.' });
    return true;
  };
  for (const block of catchBlocks(scan)) {
    checkRethrow(scan, rel, block.open, block.close, report);
    if (isHandledBody(scan.code, block.open, block.close, block.binding)) continue;
    if (licensed(text.lastIndexOf('\n', block.index) + 1, block.close, block.line)) continue;
    report.problem({ file: rel, line: block.line, rule: 'catch-handled', message: 'the catch swallows the error: no err(...), no rethrow, and the error is not passed on (console and debug logs do not count)', fix: "When the throw is the expected answer (a parser, validator or feature probe), convert it instead of catching: attempt(() => new URL(raw), () => ({ kind: 'invalid-url' }) as const) and read .ok / .value. Otherwise return err(failure), record the unexpected error (errorLog.record(source, error)) and use a defined fallback, or rethrow with { cause }." });
  }
  for (const handler of promiseCatches(scan)) {
    const { body } = handler;
    if (body.kind === 'block') checkRethrow(scan, rel, body.from, body.to, report);
    const swallowed = swallowedBy(scan.code, body);
    if (!swallowed) continue;
    const lineStart = text.lastIndexOf('\n', text.lastIndexOf('\n', handler.index - 1) - 1);
    if (licensed(lineStart, handler.argClose, handler.line)) continue;
    report.problem({ file: rel, line: handler.line, rule: 'catch-handled', message: 'the .catch handler drops the rejection', fix: 'End fire-and-forget work with .catch(reportError) (records it), or convert it with attemptAsync.' });
  }
}

/** A .catch handler that drops the rejection: a no-op reference, or a body that neither maps, rethrows nor passes the error on. */
function swallowedBy(code, body) {
  if (body.kind === 'ref') return /^(noop|ignore\w*|swallow\w*|console\.\w+)$/.test(body.name) || /\.(?:debug|trace|verbose)$/.test(body.name);
  if (body.kind === 'block') return !isHandledBody(code, body.from, body.to, body.param);
  return isEmptyExpression(code, body.from, body.to) || !isHandledExpression(code, body.from, body.to, body.param);
}

function checkRethrow(scan, rel, open, close, report) {
  const body = scan.code.slice(open, close);
  for (const match of body.matchAll(/\bthrow\s+new\s+([A-Z]\w*)\s*\(/g)) {
    const argOpen = open + match.index + match[0].length - 1;
    const argClose = matchBracket(scan.code, argOpen);
    const args = argClose === -1 ? '' : scan.code.slice(argOpen, argClose);
    if (/\bcause\b/.test(args)) continue;
    report.problem({ file: rel, line: scan.lineOf(open + match.index), rule: 'rethrow-cause', message: `throw new ${match[1]}(...) in a catch drops the original error`, fix: "Bind the error and pass it on: throw new Error('saving the task failed', { cause: error })." });
  }
}

// --- adapter-boundary ---------------------------------------------------------------------------

function isAdapter(rel, layout) {
  return rel.startsWith(`${layout.servicesDir}/`) && /^[^/]+\/[^/]+-adapter\.tsx?$/.test(rel.slice(layout.servicesDir.length + 1));
}

/** A call of attemptAsync or withTimeout (not its declaration), up to the "(" of its argument list. */
const WRAPPER_CALL = /(?<![\w$])(?:[\w$]+\s*\??\.\s*)?(?:attemptAsync|withTimeout)\s*(?:<[^()]*>)?\s*\(/g;

/**
 * The argument lists of every attemptAsync(...) / withTimeout(...) call: an await inside the task
 * callback (`attemptAsync(async () => { const r = await fetch(url); return await r.json(); }, toFailure)`)
 * cannot escape, because the wrapper turns the rejection into a failure.
 */
function wrapperRanges(code) {
  const out = [];
  for (const match of code.matchAll(WRAPPER_CALL)) {
    if (/\bfunction\s*\*?\s*$/.test(code.slice(Math.max(0, match.index - 20), match.index))) continue;
    const args = callArgs(code, match.index + match[0].length - 1);
    if (args) out.push(args);
  }
  return out;
}

function checkAdapterBoundary(file, report) {
  const { scan, rel } = file;
  const guarded = [...tryBlocks(scan).filter((block) => block.hasCatch), ...wrapperRanges(scan.code)];
  for (const match of scan.code.matchAll(/\bawait\s+/g)) {
    const at = match.index;
    if (/^(?:[\w$.]+\.)?(attemptAsync|withTimeout)\s*[<(]/.test(scan.code.slice(at + match[0].length))) continue;
    if (guarded.some((block) => at > block.open && at < block.close)) continue;
    report.problem({ file: rel, line: scan.lineOf(at), rule: 'adapter-boundary', message: 'an await in an adapter outside try/catch: a vendor rejection escapes the boundary', fix: 'Move the awaits into the task attemptAsync runs: return attemptAsync(async () => toValue(await sdk.call()), toFailure); or try { ... } catch (error) { return err(toFailure(error)); }.' });
  }
}

// --- result-ignored -----------------------------------------------------------------------------

const escapeName = (name) => name.replace(/\$/g, '\\$');

function checkIgnoredResults(files, root, layout, report) {
  const index = resultIndex(files);
  if (index.free.size === 0 && index.members.size === 0) return;
  const context = { index, root, aliases: layout.aliases, byRel: new Map(files.map((file) => [file.rel, file])) };
  const chain = String.raw`((?:[\w$]+(?:\?\.|\.))*)`;
  for (const file of files) {
    const { scan, rel } = file;
    const bindings = importBindings(file, context);
    // Declared names, plus the local names this file imports a Result function under (import { save as store }).
    const aliases = [...bindings.named].filter(([, binding]) => index.free.has(binding.imported)).map(([local]) => local);
    const names = new Set([...index.free.keys(), ...index.members.keys(), ...aliases]);
    const alternation = [...names].map(escapeName).join('|');
    const call = new RegExp(String.raw`(?<![\w$.])${chain}(${alternation})\s*\(`, 'g');
    const handlerArrow = new RegExp(String.raw`\bon[A-Z]\w*=\{\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:void\s+|await\s+)?${chain}(${alternation})\s*\(`, 'g');
    const { code } = scan;
    for (const match of code.matchAll(call)) {
      const at = match.index - (/(?<![\w$.])(?:await|void)\s+$/.exec(code.slice(Math.max(0, match.index - 12), match.index))?.[0].length ?? 0);
      const place = callPlace(code, at);
      if (place === null || !returnsResult(file, context, bindings, match[1], match[2])) continue;
      const close = matchBracket(code, match.index + match[0].length - 1);
      if (close === -1) continue;
      const after = code.slice(close + 1);
      if (place === 'statement' && /^\s*;/.test(after)) {
        report.problem({ file: rel, line: scan.lineOf(at), rule: 'result-ignored', message: `the Result of ${match[2]}() is dropped`, fix: 'Bind it and branch on result.ok (handle every failure kind), or return it to the caller.' });
      } else if (place === 'forEach' && /^\s*[),]/.test(after)) {
        report.problem({ file: rel, line: scan.lineOf(at), rule: 'result-ignored', message: `forEach drops the Result of ${match[2]}() for every item`, fix: 'Use for (const item of items) { const result = ...; if (!result.ok) ... } so each failure is handled (or collect the Results and branch on them).' });
      }
    }
    for (const match of scan.code.matchAll(handlerArrow)) {
      if (!returnsResult(file, context, bindings, match[1], match[2])) continue;
      report.problem({ file: rel, line: scan.lineOf(match.index), rule: 'result-ignored', message: `an on* handler drops the Result of ${match[2]}()`, fix: 'Call a void intent from the model hook that handles the Result (handleAdd), not the Result function.' });
    }
  }
}

/** Index of the "(" that matches the ")" at `close`, or -1. */
function openingParen(code, close) {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (code[i] === ')') depth += 1;
    else if (code[i] === '(') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the last non-space character before `at`, or -1. */
function previousToken(code, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(code[i])) i -= 1;
  return i;
}

/**
 * Where an expression that starts at `at` sits: 'statement' when it starts a statement (the start of
 * the file; after ";", "{" or "}"; after a case or default label; after the ")" of an if, for, while
 * or with head; after else or do), 'forEach' when it is the expression body of an arrow handed to
 * forEach (whose return value forEach discards), or null (a value someone uses: an assignment, an
 * argument, a ternary branch, a return).
 */
function callPlace(code, at) {
  const i = previousToken(code, at);
  if (i < 0) return 'statement';
  const ch = code[i];
  if (ch === ';' || ch === '{' || ch === '}') return 'statement';
  if (/(?<![\w$.])(?:else|do)$/.test(code.slice(Math.max(0, i - 4), i + 1))) return 'statement';
  if (ch === ':') return isCaseLabel(code, i) ? 'statement' : null;
  if (ch === ')') {
    const open = openingParen(code, i);
    const head = open === -1 ? '' : code.slice(Math.max(0, open - 16), open);
    return /(?<![\w$.])(?:if|for|while|with|for\s+await)\s*$/.test(head) ? 'statement' : null;
  }
  if (ch === '>' && code[i - 1] === '=') return isForEachArrow(code, i - 1) ? 'forEach' : null;
  return null;
}

/** True when the ":" at `colon` ends a `case <expr>:` or `default:` label (not a ternary or an object key). */
function isCaseLabel(code, colon) {
  let depth = 0;
  let start = 0;
  for (let i = colon - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']') depth += 1;
    else if (ch === '(' || ch === '[') depth -= 1;
    else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) {
      start = i + 1;
      break;
    }
  }
  return /^\s*(?:case\b[\s\S]*|default\s*)$/.test(code.slice(start, colon));
}

/** True when the "=>" at `arrow` belongs to an arrow that is the first argument of .forEach(...). */
function isForEachArrow(code, arrow) {
  let i = previousToken(code, arrow);
  if (i < 0) return false;
  let paramsStart;
  if (code[i] === ')') paramsStart = openingParen(code, i);
  else {
    const name = /[A-Za-z_$][\w$]*$/.exec(code.slice(Math.max(0, i - 64), i + 1));
    paramsStart = name ? i + 1 - name[0].length : -1;
  }
  if (paramsStart === -1) return false;
  i = previousToken(code, paramsStart);
  if (/(?<![\w$.])async$/.test(code.slice(Math.max(0, i - 5), i + 1))) i = previousToken(code, i - 4);
  return i >= 0 && code[i] === '(' && /\??\.\s*forEach\s*$/.test(code.slice(Math.max(0, i - 24), i));
}

/** The local file an import specifier of `fromRel` resolves to, or null (a package, a missing file). */
function localTarget(fromRel, spec, context) {
  const target = resolveImport(fromRel, spec, { root: context.root, aliases: context.aliases });
  return target.kind === 'local' && target.exists ? target.path : null;
}

/** `{ a, b as c, type T }` -> [{ imported: 'a', local: 'a' }, { imported: 'b', local: 'c' }] (type-only names left out). */
function namedList(text) {
  return text
    .split(',')
    .map((item) => /^\s*(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item))
    .filter((match) => match !== null && match[1] === undefined)
    .map((match) => ({ imported: match[2], local: match[3] ?? match[2] }));
}

/**
 * The value imports of a file that resolve to app files:
 *   named       local name -> { imported, target }   (import { refresh } / { refresh as reload } from '...')
 *   namespaces  local name -> target                 (import * as tasks from '...')
 */
function importBindings(file, context) {
  const { code, stringAt } = file.scan;
  const named = new Map();
  const namespaces = new Map();
  for (const match of code.matchAll(/(?:^|[;\n}])\s*import\s+(type\s+)?([^;'"`]*?)\s*from\s*(['"])/g)) {
    if (match[1]) continue;
    const spec = stringAt.get(match.index + match[0].length - 1)?.value;
    const target = spec === undefined ? null : localTarget(file.rel, spec, context);
    if (target === null) continue;
    const clause = match[2];
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace) namespaces.set(namespace[1], target);
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const item of braces ? namedList(braces[1]) : []) named.set(item.local, { imported: item.imported, target });
  }
  return { named, namespaces };
}

/** `export { a, b as c } from '...'` and `export * from '...'` of a file: [{ names: Map exported -> imported | null (all), target }]. */
function reexportsOf(file, context) {
  const { code, stringAt } = file.scan;
  const out = [];
  for (const match of code.matchAll(/\bexport\s+(?:(\*)|(type\s+)?\{([^}]*)\})\s*from\s*(['"])/g)) {
    if (match[2]) continue;
    const spec = stringAt.get(match.index + match[0].length - 1)?.value;
    const target = spec === undefined ? null : localTarget(file.rel, spec, context);
    if (target === null) continue;
    const names = match[1] ? null : new Map(namedList(match[3]).map((item) => [item.local, item.imported]));
    out.push({ names, target });
  }
  return out;
}

/** True when `rel` exports `name` as a Result-returning free function, itself or through re-exports (a barrel). */
function exportsResultFunction(context, rel, name, hops = 2) {
  if (context.index.free.get(name)?.has(rel)) return true;
  const file = context.byRel.get(rel);
  if (hops === 0 || !file) return false;
  return reexportsOf(file, context).some((entry) => {
    if (entry.names === null) return exportsResultFunction(context, entry.target, name, hops - 1);
    return entry.names.has(name) && exportsResultFunction(context, entry.target, entry.names.get(name), hops - 1);
  });
}

/** The index of the "(" whose list encloses `index` (through { } and [ ] destructuring), or -1. */
function enclosingParen(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) depth -= 1;
      else if (ch === '(') return i;
    }
  }
  return -1;
}

/**
 * True when the file binds `name` itself: a function, a const/let/var (also destructured, not a renamed
 * key), or a parameter of a function or arrow. Such a local name shadows (or simply is not) the
 * Result function another module declares under the same name.
 */
function declaresLocally(code, name) {
  const n = escapeName(name);
  if (new RegExp(String.raw`\bfunction\s*\*?\s*${n}\s*[<(]`).test(code)) return true;
  if (new RegExp(String.raw`\b(?:const|let|var)\s+${n}(?![\w$])`).test(code)) return true;
  const bound = new RegExp(String.raw`(?<![\w$.])${n}(?![\w$])(?!\s*:)`);
  for (const match of code.matchAll(/\b(?:const|let|var)\s*([{[][^;=]*[}\]])\s*(?::[^=;]*)?=/g)) {
    if (bound.test(match[1])) return true;
  }
  for (const match of code.matchAll(new RegExp(String.raw`(?<![\w$.])${n}\s*\??\s*[:,)=}]`, 'g'))) {
    const open = enclosingParen(code, match.index);
    if (open === -1) continue;
    const close = matchBracket(code, open);
    if (close === -1) continue;
    const after = code.slice(close + 1, close + 200);
    const before = code.slice(Math.max(0, open - 80), open);
    if (/^\s*(?::[^;{}]*?)?=>/.test(after) || /\bfunction\s*\*?\s*[\w$]*\s*(?:<[^()]*>)?\s*$/.test(before)) return true;
  }
  return false;
}

/**
 * True when a call without a receiver, `name(...)`, calls a Result function: one this file declares,
 * or a named import that resolves to the file declaring it (followed through re-exports). Never when
 * the file binds the name itself (a local function, const or parameter): `refresh()` in a settings
 * hook is not the `refresh()` some other module declares.
 */
function freeCallReturnsResult(file, context, bindings, name) {
  if (context.index.free.get(name)?.has(file.rel)) return true;
  const binding = bindings.named.get(name);
  if (binding === undefined || declaresLocally(file.scan.code, name)) return false;
  return exportsResultFunction(context, binding.target, binding.imported);
}

/**
 * Where the app declares Result-returning callables:
 *   free     name -> the files that declare a function or arrow constant of that name (called
 *            without a receiver: save(task))
 *   members  name -> owners, each { kind: 'type', name, file } (a type, interface or class member)
 *            or { kind: 'variable', name } (a member of an object literal bound to a const)
 */
function resultIndex(files) {
  const free = new Map();
  const members = new Map();
  for (const { scan, rel } of files) {
    const { code } = scan;
    for (const match of code.matchAll(/(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*|\b([A-Za-z_$][\w$]*)\s*[?]?\s*(?::\s*|=\s*(?:async\s*)?)?(?:<[^(]*>)?\s*)\(/g)) {
      const name = match[1] ?? match[2];
      if (!name || /^(if|for|while|switch|catch|return|function|typeof|await|new)$/.test(name)) continue;
      const open = match.index + match[0].length - 1;
      const close = matchBracket(code, open);
      if (close === -1) continue;
      if (!/^\s*(?::|=>)\s*(?:Promise\s*<\s*)?Result\s*</.test(code.slice(close + 1, close + 200))) continue;
      const owner = ownerAt(code, match.index);
      if (owner === null) continue;
      if (owner.kind === 'free') {
        if (!free.has(name)) free.set(name, new Set());
        free.get(name).add(rel);
        continue;
      }
      if (!members.has(name)) members.set(name, []);
      members.get(name).push({ ...owner, file: rel });
    }
  }
  return { free, members };
}

/**
 * What a declaration at `index` belongs to, from the nearest enclosing "{": a type, interface or
 * class (a member), an object literal bound to a const (a member of that variable), an object a
 * function with a declared return type returns (a member of that type), or nothing (module scope or
 * a function body: a free function). null when it cannot tell, so nothing is indexed.
 */
function ownerAt(code, index) {
  const open = enclosingBrace(code, index);
  if (open === -1) return { kind: 'free' };
  const before = code.slice(Math.max(0, open - 400), open).trimEnd();
  const declared = /\b(?:type\s+([A-Z][\w$]*)\b[^;{}]*=[^;{}]*|(?:interface|class)\s+([A-Z][\w$]*)\b[^;{}]*)$/.exec(before);
  if (declared) return { kind: 'type', name: declared[1] ?? declared[2] };
  const bound = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;{}]*)?=\s*(?:\(\s*)?$/.exec(before);
  if (bound) return { kind: 'variable', name: bound[1] };
  const returned = /\breturn\s*(?:\(\s*)?$/.test(before) ? enclosingBrace(code, open) : -1;
  const arrowReturn = /\)\s*:\s*([A-Z][\w$]*)(?:<[^{};]*>)?\s*=>\s*\(\s*$/.exec(before);
  if (arrowReturn) return { kind: 'type', name: arrowReturn[1] };
  if (returned !== -1) {
    const fnHead = code.slice(Math.max(0, returned - 400), returned).trimEnd();
    const typed = /\)\s*:\s*([A-Z][\w$]*)(?:<[^{};]*>)?\s*(?:=>\s*)?$/.exec(fnHead);
    return typed ? { kind: 'type', name: typed[1] } : null;
  }
  if (/(?:\)|=>)\s*(?::\s*[^{};=]+)?$/.test(before) || /\b(?:else|try|finally|do)$/.test(before)) return { kind: 'free' };
  return null;
}

/** Index of the unmatched "{" that encloses `index`, or -1 at module scope. */
function enclosingBrace(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (code[i] === '}') depth += 1;
    else if (code[i] === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/** The names a variable holding an instance of `type` usually has: taskRepository, repository, sync for SyncPort. */
function instanceNames(type) {
  const lowerFirst = (word) => word.charAt(0).toLowerCase() + word.slice(1);
  const base = type.replace(/(?:Port|Service|Adapter)$/, '') || type;
  const words = base.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) ?? [base];
  return [...new Set([lowerFirst(type), lowerFirst(base), lowerFirst(words.at(-1))])];
}

/**
 * True when `chain` + `name` calls something declared to return a Result. A call without a receiver
 * must name a free function this file declares or imports (freeCallReturnsResult). A call on a
 * namespace import (tasks.refresh() after import * as tasks) must name a free function that module
 * exports. Any other receiver (repository.add) must name a member whose owner the receiver is known
 * to be: the receiver is annotated with the owner type in this file (`repository: TaskRepository`),
 * created from it (`= createTaskRepository(...)`, `new TaskStore()`), named like an instance of it
 * (`taskRepository`, `repository`), or is the owning variable itself. So `selected.add(id)` on a Set
 * never matches a Result-returning TaskRepository.add.
 */
function returnsResult(file, context, bindings, chain, name) {
  const { index } = context;
  if (chain === '') return freeCallReturnsResult(file, context, bindings, name);
  const receiver = /([\w$]+)(?:\?\.|\.)$/.exec(chain)?.[1];
  if (receiver && chain === `${receiver}.` && bindings.namespaces.has(receiver)) {
    return exportsResultFunction(context, bindings.namespaces.get(receiver), name);
  }
  const owners = index.members.get(name);
  if (!receiver || !owners) return false;
  const { code } = file.scan;
  const escaped = receiver.replace(/\$/g, '\\$');
  return owners.some((owner) => {
    if (owner.kind === 'variable') return receiver === owner.name;
    if (receiver === 'this') return owner.file === file.rel;
    if (instanceNames(owner.name).includes(receiver)) return true;
    const annotated = new RegExp(String.raw`(?<![\w$.])${escaped}\s*\??\s*:\s*[^=;{}()]*?\b${owner.name}\b`);
    const created = new RegExp(String.raw`(?<![\w$.])${escaped}\s*(?::[^=;]*)?=\s*(?:await\s+)?(?:new\s+${owner.name}\b|(?:create|use|make)${owner.name}\s*\()`);
    return annotated.test(code) || created.test(code);
  });
}

// --- ui-error-message ---------------------------------------------------------------------------

function isUiFile(rel, layout) {
  if (rel.endsWith('.tsx')) return true;
  return rel.startsWith(`${layout.featuresDir}/`) && /\/use-[^/]+\.ts$/.test(rel);
}

function checkUiErrorMessage(file, report) {
  const { scan, rel } = file;
  const patterns = [
    /\b(?:error|err|e|ex|exception|failure|cause|reason|thrown|caught)\s*\??\.\s*message\b/g,
    /\.error\s*\??\.\s*message\b/g,
    /\bString\s*\(\s*(?:error|err|e|thrown|caught|exception)\s*\)/g,
    /\$\{\s*(?:error|err|e|thrown|caught|exception)\s*\}/g,
  ];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of scan.code.matchAll(pattern)) {
      if (isTranslationKey(scan.code, match.index)) continue;
      const line = scan.lineOf(match.index);
      if (seen.has(line)) continue;
      seen.add(line);
      report.problem({ file: rel, line, rule: 'ui-error-message', message: 'the UI shows raw error text', fix: "Show a message chosen from the failure kind (a key from the failure-message table); error text goes to the error log only." });
    }
  }
}

/** The callee of the call whose "(" is at `open`: t(...), formatMessage(...), intl.formatMessage(...). */
const TRANSLATE_CALLEE = /(?<![\w$])(?:t|(?:[\w$]+\s*\??\.\s*)*formatMessage)\s*$/;

/** True when no comma at depth 0 separates `from` and `to`: `to` sits in the first argument after `from`. */
function inFirstArgument(code, from, to) {
  let depth = 0;
  for (let i = from + 1; i < to; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) return false;
  }
  return true;
}

/**
 * True when the match is the message key handed to t() or formatMessage(), not text shown as is:
 * `t(fieldState.error.message ?? 'forms.invalid')` with a schema whose messages are catalog keys
 * (forms-and-input), `intl.formatMessage({ id: failure.message })`. A message passed as a value
 * (`t('x', { detail: error.message })`) still shows raw text and still fails.
 */
function isTranslationKey(code, index) {
  const open = enclosingOpener(code, index);
  if (open === -1) return false;
  if (code[open] === '(') return TRANSLATE_CALLEE.test(code.slice(Math.max(0, open - 80), open)) && inFirstArgument(code, open, index);
  if (code[open] !== '{') return false;
  const before = code.slice(0, open).trimEnd();
  const paren = before.length - 1;
  return code[paren] === '(' && /formatMessage\s*$/.test(before.slice(0, paren).slice(-80)) && /^\s*id\s*:/.test(code.slice(open + 1, index).replace(/[\s\S]*,/, ''));
}

/** Index of the innermost unmatched "(", "[" or "{" before `index`, or -1. */
function enclosingOpener(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// --- failure-message-key ------------------------------------------------------------------------

function checkFailureMessageKeys(root, files, layout, options, report) {
  const tables = files.flatMap((file) => messageTables(file));
  if (tables.length === 0) return;
  const catalogRel = options.catalog ?? layout.config?.sourceCatalog ?? `${layout.i18nDir}/catalogs/en.json`;
  const reason = notYetCreated(root, { file: catalogRel, owner: 'i18n-strings-and-catalogs' });
  if (reason) {
    report.skip({ file: catalogRel, rule: 'failure-message-key', message: reason });
    return;
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(join(root, catalogRel), 'utf8'));
  } catch (error) {
    report.problem({ file: catalogRel, line: 1, rule: 'failure-message-key', message: `the catalog is not valid JSON (${error.message})`, fix: 'Fix the catalog JSON.' });
    return;
  }
  for (const table of tables) {
    for (const entry of table.values) {
      if (Object.hasOwn(catalog, entry.value)) continue;
      report.problem({ file: table.rel, line: entry.line, rule: 'failure-message-key', message: `message key "${entry.value}" is not in ${catalogRel}`, fix: `Add "${entry.value}" to the source catalog (and every locale), or point the kind at an existing key.` });
    }
  }
}

/** Object literals typed as (or satisfying) Record<XFailure['kind'], ...>: their string values. */
function messageTables(file) {
  const { scan, rel, text } = file;
  const tables = [];
  const kindRecord = /^\s*(?:as\s+const\s+)?satisfies\s+(?:Readonly\s*<\s*)?Record\s*<\s*[\w$.]+\s*\[\s*'kind'\s*\]/;
  for (const match of scan.code.matchAll(/\bconst\s+[\w$]+\s*(:\s*(?:Readonly\s*<\s*)?Record\s*<[^=]*)?=\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(scan.code, open);
    if (close === -1) continue;
    const annotated = match[1] !== undefined && /\[\s*'kind'\s*\]/.test(text.slice(match.index, open));
    if (!annotated && !kindRecord.test(text.slice(close + 1, close + 200))) continue;
    const values = [];
    const body = topLevelOnly(scan.code.slice(open + 1, close));
    for (const entry of body.matchAll(/:\s*(['"])/g)) {
      const index = open + 1 + entry.index + entry[0].length - 1;
      const literal = scan.stringAt.get(index);
      if (literal) values.push({ value: literal.value, line: literal.line });
    }
    tables.push({ rel, values });
  }
  return tables;
}

// --- no-destructive-recovery --------------------------------------------------------------------

function checkDestructiveRecovery(file, report) {
  const { scan, rel } = file;
  const ranges = [
    ...catchBlocks(scan).map((block) => ({ from: block.open, to: block.close, where: 'a catch block' })),
    ...promiseCatches(scan).map((handler) => ({ from: handler.argOpen, to: handler.argClose, where: 'a .catch handler' })),
    ...failureBranches(scan).map((branch) => ({ from: branch.open, to: branch.close, where: 'a failure branch' })),
  ];
  const seen = new Set();
  for (const range of ranges) {
    const code = scan.code.slice(range.from, range.to);
    const hits = DESTRUCTIVE.map((pattern) => pattern.exec(code)).filter(Boolean).map((hit) => ({ index: hit.index, what: hit[0].replace(/\s*\($/, '()') }));
    const sql = DESTRUCTIVE_SQL.exec(scan.codeKeep.slice(range.from, range.to));
    if (sql) hits.push({ index: sql.index, what: sql[1].toUpperCase() });
    for (const hit of hits) {
      const line = scan.lineOf(range.from + hit.index);
      if (seen.has(`${line}:${hit.what}`)) continue;
      seen.add(`${line}:${hit.what}`);
      report.problem({ file: rel, line, rule: 'no-destructive-recovery', message: `${hit.what} on an error path (${range.where}) destroys data the user may still need`, fix: 'Keep the data: quarantine the bad record, open read-only, keep the input, and show the failure with a retry.' });
    }
  }
}

run(main);
