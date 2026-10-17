#!/usr/bin/env node
// check-error-net.mjs: proves the global error net of a React Native app is wired: one module whose
// handler forwards to React Native's, turns on Hermes rejection tracking in every build (no __DEV__ or
// NODE_ENV test anywhere in the net's files) and calls its sink inside try/catch; the root layout (or
// the entry) installs it at module scope; some app file connects it to the error log; the root route
// exports an ErrorBoundary that records the error and never retries or navigates away by itself.
// Usage: node check-error-net.mjs [repo-root] [options]   (see --help)

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, notYetCreated, parseArgs, resolveLayout, run } from './check-lib.mjs';
import {
  braceDepthAt,
  callArgs,
  readAppSources,
  readPackageJson,
  repoDependsOn,
  tryBlocks,
  withoutDevLogs,
} from './lib/error-scan.mjs';
import { importsOf, matchBracket, resolveImport, scanSource, typeRegionsOf } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-error-net',
  summary:
    'Checks the global error net of a React Native app: one module chains the global handler, tracks unhandled rejections in every build and guards its sink; the root layout installs it at module scope; the root route exports an ErrorBoundary that records and never retries by itself.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout, src)' },
    'routes-dir': { type: 'string', value: 'dir', help: 'Expo Router routes folder (default: from resolveLayout, src/app)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  net-single       exactly one app file calls ErrorUtils.setGlobalHandler (the error net)',
    '  net-chains       the net keeps getGlobalHandler()\'s handler (or one alias of it, such as current[CHAINED] ?? current) and',
    '                   the function it gives setGlobalHandler calls it (directly or through one local function it calls)',
    '  net-rejections   the net calls HermesInternal.enablePromiseRejectionTracker with onUnhandled, and no development-only test',
    '                   (__DEV__, process.env.NODE_ENV !== \'production\' / === \'development\') governs the code that tracks rejections',
    '  net-every-build  the net module, the instance module and the installer contain no other development-only test (a guard over',
    '                   the handler or the previous handler\'s call fails net-chains, one over an install call net-installed)',
    '  net-guarded      every call of the connected sink (connect\'s parameter, a variable it is stored in, or a local function',
    '                   parameter it is handed to) sits inside a try block that has a catch (a throwing logger inside the global',
    '                   handler recurses)',
    '  net-connected    some app file other than the net calls <instance>.connect(...) on the instance the createErrorNet file',
    '                   exports, or passes that instance to an imported function whose parameter at that position calls .connect(...)',
    '                   (itself or one function further); a call under a development-only test does not count',
    '  net-installed    the first app import of the root layout (or of a local package.json main, the custom entry) is a side-effect import of a module that installs the net at module scope',
    '  root-boundary    the root layout exports ErrorBoundary (without expo-router: some file implements componentDidCatch)',
    '  boundary-records the ErrorBoundary implementation records the error (record/report/log call, or componentDidCatch),',
    '                   and the root layout\'s record: option calls something besides console.*',
    '  no-auto-retry    neither the ErrorBoundary implementation nor the Fallback it is given (and the components that file',
    '                   imports) calls retry/reset/restart/reload/onRestart/onAction, or navigates away (router.replace/push/back/',
    '                   navigate/dismissAll, navigation.reset), from an effect or a timer, or hands one of them to a timer',
    'NOT APPLICABLE when package.json lists no react-native. Exit 2 when package.json or the source folder is missing.',
    'SKIP <routes-dir>/_layout.tsx [net-installed|root-boundary] when expo-router is installed and the root layout is not yet created (app-startup-and-bootstrap creates it);',
    'the same SKIP for [net-connected] when, in addition, no app file connects the net yet (the composition root runs from the root layout).',
  ].join('\n'),
};

const RECORD_CALL = /(?<![\w$])(?:record|report|log|capture)\w*\s*\(|\.\s*(?:record|report|log|capture)\w*\s*\(|\bonError\s*\(/;
/** The ways out a fallback is handed (retry, onRestart, onAction) and the calls that restart the app. */
const WAY_OUT = String.raw`(?:retry|restart|reset\w*|reload\w*|on(?:Restart|Action|Retry|Reset))`;
/** Navigation that leaves the fallback by itself: the same loop when the target screen throws too. */
const NAVIGATE = String.raw`(?:router|navigation|navigator|nav)\s*\??\.\s*(?:replace|push|back|navigate|dismissAll|dismissTo|dismiss|reset|goBack|popToTop)`;
const RETRY_CALL = new RegExp(String.raw`(?<![\w$])${NAVIGATE}\s*\(|(?<![\w$])${WAY_OUT}\s*\(|\.\s*${WAY_OUT}\s*\(`);
/** A way out handed to a timer as a reference: setTimeout(onRestart, 3000), requestAnimationFrame(props.retry), setTimeout(router.back, 2000). */
const RETRY_REFERENCE = new RegExp(String.raw`^\(\s*(?:((?<![\w$])${NAVIGATE})|(?:[\w$]+\s*\.\s*)*(${WAY_OUT}))\s*[,)]`);
const TIMERS = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'setImmediate']);
/** Guards that make code run in development builds only. */
const DEV_GUARD = String.raw`(?:__DEV__|process\.env\.NODE_ENV\s*(?:!==?\s*['"]production['"]|===?\s*['"]development['"])|['"]production['"]\s*!==?\s*process\.env\.NODE_ENV|['"]development['"]\s*===?\s*process\.env\.NODE_ENV)`;

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const report = createReporter({ name: SPEC.name, json: options.json });
  const pkg = readPackageJson(root);
  if (pkg === null) fail(`no package.json in ${root}`, 'Pass the app repo root (the folder with package.json).');
  if (pkg.invalid) fail(`package.json in ${root} is not valid JSON`, 'Fix package.json, then rerun.');
  if (!repoDependsOn(root, pkg, 'react-native')) return report.notApplicable('react-native is not in package.json');
  const layout = resolveLayout(root, { srcDir: options['src-dir'], routesDir: options['routes-dir'] });
  if (!existsSync(join(root, layout.srcDir))) fail(`nothing to check: ${layout.srcDir}/ does not exist`, 'Pass the app repo root, or --src-dir <dir>.');
  const files = readAppSources(root, layout.srcDir);
  const app = files.filter((file) => !file.isTest);
  const net = checkNetModule(app, layout, report);
  const hasRouter = repoDependsOn(root, pkg, 'expo-router');
  const rootLayout = hasRouter ? findRootLayout(root, layout) : null;
  if (net) checkConnected(root, layout, app, net.rel, rootLayout, report);
  const installers = [];
  if (rootLayout?.skip) {
    report.skip({ file: rootLayout.rel, rule: 'net-installed', message: rootLayout.skip });
    report.skip({ file: rootLayout.rel, rule: 'root-boundary', message: rootLayout.skip });
  } else {
    if (net) installers.push(...checkInstalled(root, layout, installCandidates(root, pkg, rootLayout), net.rel, report));
    checkBoundary(root, layout, app, rootLayout, report);
  }
  if (net) {
    const byRel = new Map(app.map((file) => [file.rel, file]));
    const instanceFiles = app.filter((file) => /\bexport\s+const\s+[A-Za-z_$][\w$]*\s*(?::[^=;]*)?=\s*createErrorNet\s*\(/.test(file.scan.code));
    checkEveryBuild([net, ...instanceFiles, ...installers.map((rel) => byRel.get(rel)).filter(Boolean)], report);
  }
  return report.finish({ checked: files.length, unit: 'source files' });
}

// --- the net module -----------------------------------------------------------------------------

function checkNetModule(app, layout, report) {
  // The net is the handler-setting file that looks most like one (chains, tracks rejections, guards).
  const score = ({ scan }) => [/\.\s*getGlobalHandler\s*\(/, /\benablePromiseRejectionTracker\b/, /\btry\s*\{/].filter((pattern) => pattern.test(scan.code)).length;
  const nets = app.filter((file) => /\.\s*setGlobalHandler\s*\(/.test(file.scan.code)).sort((a, b) => score(b) - score(a));
  if (nets.length === 0) {
    report.problem({ file: `${layout.srcDir}/`, line: 0, rule: 'net-single', message: 'no file installs a global error handler (ErrorUtils.setGlobalHandler)', fix: 'Copy templates/src/services/error-net/ (error-net.ts, app-error-net.ts, install-error-net.ts and their tests) from the error-handling-typed-results skill.' });
    return null;
  }
  for (const extra of nets.slice(1)) {
    const at = extra.scan.code.search(/\.\s*setGlobalHandler\s*\(/);
    report.problem({ file: extra.rel, line: extra.scan.lineOf(at), rule: 'net-single', message: `a second global handler (the net is ${nets[0].rel})`, fix: 'Keep one error net; report from here through it (appErrorNet.report) instead of replacing the handler.' });
  }
  const { rel, scan } = nets[0];
  checkChains(rel, scan, report);
  checkRejections(rel, scan, report);
  checkGuarded(rel, scan, report);
  return { rel, scan };
}

const escapeName = (name) => name.replace(/\$/g, '\\$');
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Index right after the depth-0 "=>" that follows `from` (a return type may sit between), or -1. */
function arrowAfter(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || (ch === '>' && code[i - 1] !== '=')) depth -= 1;
    if (depth < 0) return -1;
    if (depth === 0 && ch === '=' && code[i + 1] === '>') return i + 2;
    if (depth === 0 && (ch === ';' || ch === ',' || (ch === '=' && code[i + 1] !== '>'))) return -1;
  }
  return -1;
}

/**
 * The function expression starting at `from` (`(a: A): R => {...}`, `a => expr`, `async () => ...`,
 * `function (a) {...}`): { params, from, to } with the body's [from, to) range, or null.
 */
function functionAt(code, from) {
  let at = from;
  const skip = () => {
    while (/\s/.test(code[at] ?? '')) at += 1;
  };
  skip();
  if (/^async\b/.test(code.slice(at))) {
    at += 5;
    skip();
  }
  let params;
  let bodyStart;
  const declared = /^function\b\s*\*?\s*[\w$]*\s*(?:<[^()]*>)?\s*\(/.exec(code.slice(at));
  if (declared) {
    const open = at + declared[0].length - 1;
    const close = matchBracket(code, open);
    if (close === -1) return null;
    params = code.slice(open + 1, close);
    bodyStart = code.indexOf('{', close);
    if (bodyStart === -1) return null;
  } else {
    if (code[at] === '(') {
      const close = matchBracket(code, at);
      if (close === -1) return null;
      params = code.slice(at + 1, close);
      bodyStart = arrowAfter(code, close + 1);
    } else {
      const single = /^([A-Za-z_$][\w$]*)\s*=>/.exec(code.slice(at));
      if (!single) return null;
      params = single[1];
      bodyStart = at + single[0].length;
    }
    if (bodyStart === -1) return null;
    while (/\s/.test(code[bodyStart] ?? '')) bodyStart += 1;
  }
  if (code[bodyStart] === '{') {
    const close = matchBracket(code, bodyStart);
    return close === -1 ? null : { params, from: bodyStart + 1, to: close };
  }
  let depth = 0;
  for (let i = bodyStart; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return { params, from: bodyStart, to: i };
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return { params, from: bodyStart, to: i };
  }
  return { params, from: bodyStart, to: code.length };
}

/** A local function by name: `function name(...)` or `const name = (...) => ...`; { params, from, to } or null. */
function localFunction(code, name) {
  const n = escapeName(name);
  const declared = new RegExp(String.raw`\bfunction\s*\*?\s*${n}\s*(?:<[^()]*>)?\s*\(`).exec(code);
  if (declared) return functionAt(code, declared.index);
  const bound = new RegExp(String.raw`\b(?:const|let|var)\s+${n}\s*(?::[^=;]*)?=\s*`).exec(code);
  return bound ? functionAt(code, bound.index + bound[0].length) : null;
}

/** Parameter names of a parameter list text: `(target: ErrorSink, report: ErrorReport)` -> ['target', 'report']. */
function paramNames(params) {
  const out = [];
  let depth = 0;
  let start = 0;
  const push = (text) => {
    const name = /^\s*(?:readonly\s+)?(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(text)?.[1];
    out.push(name ?? null);
  };
  for (let i = 0; i < params.length; i += 1) {
    const ch = params[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || (ch === '>' && params[i - 1] !== '=')) depth -= 1;
    else if (ch === ',' && depth === 0) {
      push(params.slice(start, i));
      start = i + 1;
    }
  }
  if (params.trim() !== '') push(params.slice(start));
  return out;
}

/** Top-level arguments of the call whose "(" is at `open`, trimmed. */
function argumentTexts(code, open) {
  const args = callArgs(code, open);
  if (!args) return [];
  const inner = code.slice(open + 1, args.close);
  return inner.trim() === '' ? [] : splitTop(inner);
}

function splitTop(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

/** True when `body` calls one of `names`: name(...), name?.(...), name.call(...), name.apply(...). */
function callsAny(body, names) {
  return [...names].some((name) => new RegExp(String.raw`(?<![\w$.])${escapeName(name)}\s*(?:\?\.\s*)?(?:\(|\.\s*(?:call|apply)\s*\()`).test(body));
}

/**
 * net-chains: the handler the net installs must hand every error to the handler it replaced, or
 * LogBox stays silent in development and a fatal error no longer crashes in release. Reading
 * getGlobalHandler() is not enough: the function setGlobalHandler receives must call it.
 */
function checkChains(rel, scan, report) {
  const { code } = scan;
  const setCalls = [...code.matchAll(/\.\s*setGlobalHandler\s*\(/g)];
  const line = scan.lineOf(setCalls[0].index);
  const fix = 'const previous = errorUtils.getGlobalHandler(); then, inside the handler you install: record first, then previous(error, isFatal).';
  if (!/\.\s*getGlobalHandler\s*\(/.test(code)) {
    report.problem({ file: rel, line, rule: 'net-chains', message: 'the handler replaces React Native\'s instead of chaining it', fix });
    return;
  }
  const kept = keptHandlerNames(code);
  const handlers = [];
  for (const call of setCalls) {
    const open = call.index + call[0].length - 1;
    const [arg = ''] = argumentTexts(code, open);
    if (IDENTIFIER.test(arg)) {
      if (kept.has(arg)) continue; // restoring the previous handler, not installing one
      const fn = localFunction(code, arg);
      if (fn) handlers.push({ fn, at: call.index });
    } else {
      const fn = functionAt(code, open + 1);
      if (fn) handlers.push({ fn, at: call.index });
    }
  }
  if (handlers.length === 0) return; // only restores, or a handler the file receives from elsewhere: nothing to judge
  const forwards = ({ from, to }, depth) => {
    const body = code.slice(from, to);
    if (callsAny(body, kept)) return true;
    if (depth === 0) return false;
    return [...body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].some((match) => {
      const fn = localFunction(code, match[1]);
      return fn !== null && fn.from !== from && forwards(fn, depth - 1);
    });
  };
  if (handlers.some((handler) => forwards(handler.fn, 1))) return;
  const names = kept.size > 0 ? [...kept].join(' / ') : 'the getGlobalHandler() result';
  report.problem({ file: rel, line: scan.lineOf(handlers[0].at), rule: 'net-chains', message: `the installed handler never calls the handler it replaced (${names}): LogBox stays silent in development and a fatal error no longer crashes in release`, fix });
}

/**
 * connect's parameter and body range: `connect: (sink) => {...}`, `const connect = (sink) => ...`,
 * `connect(sink) {...}` (a method) or `function connect(sink) {...}`; type members are skipped.
 */
function connectFunction(code) {
  const types = typeRegionsOf(code);
  const inType = (at) => types.some(([from, to]) => at >= from && at <= to);
  for (const match of code.matchAll(/(?:(?<![\w$.])connect\s*:|\b(?:const|let|var)\s+connect\s*(?::[^=;]*)?=)\s*/g)) {
    if (inType(match.index)) continue;
    const fn = functionAt(code, match.index + match[0].length);
    const [param] = fn ? paramNames(fn.params) : [];
    if (param) return { param, ...fn };
  }
  for (const match of code.matchAll(/(?<![\w$.])connect\s*\(/g)) {
    if (inType(match.index)) continue;
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);
    const head = close === -1 ? null : /^\s*(?::[^{;=]*)?\{/.exec(code.slice(close + 1));
    if (!head) continue;
    const bodyOpen = close + head[0].length;
    const bodyClose = matchBracket(code, bodyOpen);
    const params = code.slice(open + 1, close);
    const [param] = paramNames(params);
    if (param && bodyClose !== -1) return { param, params, from: bodyOpen + 1, to: bodyClose };
  }
  return null;
}

/**
 * net-guarded: a sink that throws inside the global handler re-enters the handler and recurses. So
 * every call of the connected sink (connect's parameter, the variable it is stored in, or the
 * parameter of a local function it is handed to) must sit inside a try block that has a catch.
 */
function checkGuarded(rel, scan, report) {
  const { code } = scan;
  const guards = tryBlocks(scan).filter((block) => block.hasCatch);
  const setLine = scan.lineOf(code.search(/\.\s*setGlobalHandler\s*\(/));
  const fix = 'Call the sink inside try { sink(report); } catch (sinkError) { fallbackLog(..., sinkError); } (console.error reaches the native log in release).';
  const connect = connectFunction(code);
  if (connect === null) {
    if (guards.length === 0) report.problem({ file: rel, line: setLine, rule: 'net-guarded', message: 'the sink is not guarded: a throwing error log inside the global handler recurses until the app dies', fix });
    return;
  }
  const sinks = new Set([connect.param]);
  const connectBody = code.slice(connect.from, connect.to);
  for (const match of connectBody.matchAll(new RegExp(String.raw`(?<![\w$.])([A-Za-z_$][\w$]*)\s*=\s*${escapeName(connect.param)}\s*(?=[;\n,)}])`, 'g'))) sinks.add(match[1]);
  // Follow the sink into local helpers it is handed to: deliver(sink, report) -> deliver's own parameter.
  for (let round = 0; round < 2; round += 1) {
    for (const call of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const args = argumentTexts(code, call.index + call[0].length - 1);
      args.forEach((arg, position) => {
        if (!sinks.has(arg)) return;
        const fn = localFunction(code, call[1]);
        const name = fn ? paramNames(fn.params)[position] : null;
        if (name) sinks.add(name);
      });
    }
  }
  const calls = [...sinks].flatMap((name) => [...code.matchAll(new RegExp(String.raw`(?<![\w$.])${escapeName(name)}\s*(?:\?\.\s*)?(?:\(|\.\s*(?:call|apply)\s*\()`, 'g'))].map((match) => match.index));
  const sinkCalls = calls.filter((at) => !/\bfunction\s*$/.test(code.slice(Math.max(0, at - 12), at)));
  if (sinkCalls.length === 0) {
    report.problem({ file: rel, line: setLine, rule: 'net-guarded', message: `the sink connect() receives (${connect.param}) is never called inside try/catch`, fix });
    return;
  }
  for (const at of sinkCalls) {
    if (guards.some((block) => at > block.open && at < block.close)) continue;
    report.problem({ file: rel, line: scan.lineOf(at), rule: 'net-guarded', message: 'the error sink is called outside try/catch: a throwing error log inside the global handler recurses until the app dies', fix });
  }
}

function checkRejections(rel, scan, report) {
  const { code } = scan;
  // Member accesses only (HermesInternal.enablePromiseRejectionTracker, hermes?.enable...): a type
  // declaration that merely names the hook installs nothing. Development-only guards around it are
  // judged by checkEveryBuild with every other guard in the net's files.
  const calls = [...code.matchAll(/(?:\?\.|\.)\s*enablePromiseRejectionTracker\b/g)];
  if (calls.length === 0 || !/\bonUnhandled\b/.test(code)) {
    const fix = 'Call HermesInternal.enablePromiseRejectionTracker({ allRejections: true, onUnhandled, onHandled }) in every build: React Native turns it on only in development.';
    report.problem({ file: rel, line: 1, rule: 'net-rejections', message: 'unhandled promise rejections are not tracked (release builds drop them silently)', fix });
  }
}

// --- development-only guards (net-rejections, net-chains, net-installed, net-every-build) ----------

/** Index of the opener that matches the closer at `close` (strings are blanked in code), or -1. */
function openerOf(code, close) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const want = pairs[code[close]];
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (code[i] === code[close]) depth += 1;
    else if (code[i] === want) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Start of the statement around `at`: after the ";" or the unmatched "{" before it (balanced brackets are skipped). */
function statementStart(code, at) {
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') {
      const open = openerOf(code, i);
      if (open === -1) return 0;
      i = open;
    } else if (ch === ';' || ch === '{') return i + 1;
  }
  return 0;
}

/** End of the statement around `at`: its ";" or the unmatched "}" after it (balanced brackets are skipped). */
function statementEnd(code, at) {
  for (let i = at; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      const close = matchBracket(code, i);
      if (close === -1) return code.length;
      i = close;
    } else if (ch === ';' || ch === '}') return ch === ';' ? i + 1 : i;
  }
  return code.length;
}

/** The "(" of the `if (...)` head that contains `at`, or -1 (only through parentheses, within one statement). */
function ifHeadAround(code, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      if (depth > 0) depth -= 1;
      else if (/(?<![\w$.])if\s*$/.test(code.slice(Math.max(0, i - 8), i))) return i;
    } else if (depth === 0 && (ch === ';' || ch === '{' || ch === '}')) return -1;
  }
  return -1;
}

/** [from, to) of the branch that starts at `from` (a block or one statement). */
function branchAt(code, from) {
  let at = from;
  while (/\s/.test(code[at] ?? '')) at += 1;
  if (code[at] === '{') {
    const close = matchBracket(code, at);
    return [at, close === -1 ? code.length : close + 1];
  }
  return [at, statementEnd(code, at)];
}

/**
 * The code a development-only test at `at` governs:
 *   if (<guard>) ... [else ...]      the whole if statement (one of its branches runs in one kind of build only)
 *   if (!<guard>) return;            an early exit: the rest of the enclosing block
 *   a ternary, && / ||, a const      the enclosing statement (or the object literal it sits in)
 */
function governedRange(code, at) {
  const head = ifHeadAround(code, at);
  if (head === -1) return [statementStart(code, at), statementEnd(code, at)];
  const headClose = matchBracket(code, head);
  if (headClose === -1) return [head, code.length];
  const [bodyFrom, bodyTo] = branchAt(code, headClose + 1);
  const elseMatch = /^\s*else\b/.exec(code.slice(bodyTo));
  const elseBranch = elseMatch ? branchAt(code, bodyTo + elseMatch[0].length) : null;
  const exits = ([from, to]) => /^\s*(?:return\b[^;]*|throw\b[^;]*)?;?\s*$/.test(code.slice(from, to).replace(/^\{|\}$/g, ''));
  if (exits([bodyFrom, bodyTo]) || (elseBranch !== null && exits(elseBranch))) {
    const open = enclosingOpenBrace(code, head);
    const close = open === -1 ? code.length : matchBracket(code, open);
    return [head, close === -1 ? code.length : close];
  }
  return [head, elseBranch ? elseBranch[1] : bodyTo];
}

function enclosingOpenBrace(code, index) {
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

/**
 * Every development-only test in a file (__DEV__, the NODE_ENV forms) and the code it governs:
 * [{ at, from, to }]. Found in codeKeep (the NODE_ENV forms compare strings), never inside a string.
 */
function devGuards(scan) {
  const out = [];
  for (const match of scan.codeKeep.matchAll(new RegExp(DEV_GUARD, 'g'))) {
    if (scan.code[match.index] !== scan.codeKeep[match.index]) continue; // inside a string literal
    const [from, to] = governedRange(scan.code, match.index);
    out.push({ at: match.index, from, to });
  }
  return out;
}

/** The names the net keeps React Native's previous handler under (see checkChains). */
function keptHandlerNames(code) {
  const kept = new Set([...code.matchAll(/(?:\b(?:const|let|var)\s+|(?<![\w$.]))([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*[^;=]*?\.\s*getGlobalHandler\s*(?:\?\.\s*)?\(\s*\)/g)].map((match) => match[1]));
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*([^;]+);/g)) {
    const mentions = [...kept].some((name) => new RegExp(String.raw`(?<![\w$.])${escapeName(name)}(?![\w$])`).test(match[2]));
    if (mentions && !/\.\s*getGlobalHandler\s*\(/.test(match[2])) kept.add(match[1]);
  }
  return kept;
}

const REJECTION_CODE = /\b(?:enablePromiseRejectionTracker|enableRejectionTracker|rejectionOptions|onUnhandled|allRejections)\b/;

/**
 * net-every-build (and the rule a guard defeats): the net exists for release builds, where React
 * Native tracks no rejection and nobody watches LogBox. So the net module, the module that creates the
 * app's instance and the installer never branch on __DEV__ or NODE_ENV. A guard that governs rejection
 * tracking fails net-rejections, one over the handler or the previous handler's call net-chains, one
 * over an install call net-installed; any other guard (a flag such as const isTracking = __DEV__)
 * fails net-every-build, because the code it feeds is out of sight.
 */
function checkEveryBuild(files, report) {
  const seen = new Set();
  for (const { rel, scan } of files) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const kept = keptHandlerNames(scan.code);
    for (const guard of devGuards(scan)) {
      const region = scan.code.slice(guard.from, guard.to);
      const line = scan.lineOf(guard.at);
      if (REJECTION_CODE.test(region)) {
        const message = 'rejection tracking depends on a build check (__DEV__ or NODE_ENV): release builds must track rejections too, or they drop them silently';
        report.problem({ file: rel, line, rule: 'net-rejections', message, fix: 'Remove the guard: the net enables HermesInternal.enablePromiseRejectionTracker in every build (React Native turns it on in development only).' });
      } else if (/\.\s*(?:setGlobalHandler|getGlobalHandler)\s*\(/.test(region) || callsAny(region, kept)) {
        report.problem({ file: rel, line, rule: 'net-chains', message: 'the global handler is installed or forwards only in one kind of build (__DEV__ or a NODE_ENV guard): a fatal error must reach React Native\'s handler in release too', fix: 'Remove the guard: record, then call the previous handler, in every build.' });
      } else if (/(?<![\w$])(?:[\w$]+\s*\??\.\s*)?install\w*\s*\(/.test(region)) {
        report.problem({ file: rel, line, rule: 'net-installed', message: 'the error net is installed only in one kind of build (__DEV__ or a NODE_ENV guard): release builds run without it', fix: 'Remove the guard: install-error-net.ts calls appErrorNet.install() unconditionally.' });
      } else {
        report.problem({ file: rel, line, rule: 'net-every-build', message: 'the error net tests __DEV__ or NODE_ENV: the net must behave the same in every build, and code fed by such a flag is out of sight', fix: 'Remove the development-only test from the net module, the instance module and the installer.' });
      }
    }
  }
}

// --- net-connected --------------------------------------------------------------------------------

/** Named value imports of a file that resolve to app files: local name -> { imported, target }. */
function namedImports(root, layout, file) {
  const { code, stringAt } = file.scan;
  const out = new Map();
  for (const match of code.matchAll(/(?:^|[;\n}])\s*import\s+(type\s+)?([^;'"`]*?)\s*from\s*(['"])/g)) {
    if (match[1]) continue;
    const spec = stringAt.get(match.index + match[0].length - 1)?.value;
    const target = spec === undefined ? null : resolveImport(file.rel, spec, { root, aliases: layout.aliases });
    if (!target || target.kind !== 'local' || !target.exists) continue;
    const braces = /\{([^}]*)\}/.exec(match[2]);
    for (const item of braces ? braces[1].split(',') : []) {
      const named = /^\s*(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(item);
      if (named && !named[1]) out.set(named[3] ?? named[2], { imported: named[2], target: target.path });
    }
  }
  return out;
}

/**
 * True when the function `name` of file `rel` connects what it receives as its argument number
 * `position`: its parameter there calls .connect(...) (`net.connect(sink)`), or the function hands
 * that parameter on, at most `hops` more times, to a function (local or imported) that does. A
 * .connect(...) on anything else (a websocket, a store) does not count.
 */
function connectsParameter(context, rel, name, position, hops = 1) {
  const file = context.byRel.get(rel);
  if (!file) return false;
  const { code } = file.scan;
  const fn = localFunction(code, name);
  const param = fn ? paramNames(fn.params)[position] : null;
  if (!param) return false;
  const body = code.slice(fn.from, fn.to);
  if (new RegExp(String.raw`(?<![\w$.])${escapeName(param)}\s*\??\.\s*connect\s*\(`).test(body)) return true;
  if (hops === 0) return false;
  const imports = namedImports(context.root, context.layout, file);
  for (const call of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const next = argumentTexts(code, fn.from + call.index + call[0].length - 1).indexOf(param);
    if (next === -1) continue;
    const imported = imports.get(call[1]);
    if (imported && connectsParameter(context, imported.target, imported.imported, next, hops - 1)) return true;
    if (!imported && call[1] !== name && connectsParameter(context, rel, call[1], next, hops - 1)) return true;
  }
  return false;
}

const callPattern = (name) => new RegExp(String.raw`(?<![\w$.])${escapeName(name)}\s*\(`, 'g');

/**
 * net-connected: the net buffers reports until connect(sink) runs, so a net nobody connects keeps
 * every report in memory until the process ends. An app file other than the net module connects it
 * when it (a) calls <instance>.connect(...) on the instance the createErrorNet file exports (importing
 * it, or being that file); (b) passes that instance to a function imported from another file whose
 * matching parameter calls .connect(...), itself or through one more function it hands the parameter
 * to (connectErrorLog(appErrorNet, services.errorLog)); or (c) calls a function imported from a file
 * that does (a) itself. A call under a development-only guard (__DEV__, NODE_ENV) connects nothing in
 * release, so it does not count. A net not built on createErrorNet counts as connected when some file
 * calls a connect* function the net module exports.
 */
function checkConnected(root, layout, app, netRel, rootLayout, report) {
  const byRel = new Map(app.map((file) => [file.rel, file]));
  const context = { root, layout, byRel };
  const guardsOf = new Map();
  const devOnlyAt = (file, at) => {
    if (!guardsOf.has(file.rel)) guardsOf.set(file.rel, devGuards(file.scan));
    return guardsOf.get(file.rel).some((guard) => at >= guard.from && at < guard.to);
  };
  let includeDev = false;
  /** The matches of `pattern` in `file`, without those under a development-only guard (unless includeDev). */
  const everyBuild = (file, pattern) => [...file.scan.code.matchAll(pattern)].filter((match) => includeDev || !devOnlyAt(file, match.index));
  const instances = app.flatMap((file) => [...file.scan.code.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*createErrorNet\s*\(/g)].map((match) => ({ rel: file.rel, name: match[1], line: file.scan.lineOf(match.index) })));
  const instanceLocals = (file, imports) => [
    ...[...imports].filter(([, entry]) => instances.some((instance) => instance.rel === entry.target && instance.name === entry.imported)).map(([local]) => local),
    ...instances.filter((instance) => instance.rel === file.rel).map((instance) => instance.name),
  ];
  const connectsDirectly = (file) => {
    if (file.rel === netRel) return false;
    const locals = instanceLocals(file, namedImports(root, layout, file));
    return locals.some((local) => everyBuild(file, new RegExp(String.raw`(?<![\w$.])${escapeName(local)}\s*\??\.\s*connect\s*\(`, 'g')).length > 0);
  };
  const isConnected = (file) => {
    if (file.rel === netRel) return false;
    const imports = namedImports(root, layout, file);
    if (instances.length === 0) {
      return [...imports].some(([local, entry]) => entry.target === netRel && /^connect/.test(entry.imported) && everyBuild(file, callPattern(local)).length > 0);
    }
    if (connectsDirectly(file)) return true;
    const locals = new Set(instanceLocals(file, imports));
    for (const [local, entry] of imports) {
      if (entry.target === netRel) continue;
      for (const call of everyBuild(file, callPattern(local))) {
        const position = argumentTexts(file.scan.code, call.index + call[0].length - 1).findIndex((arg) => locals.has(arg));
        if (position !== -1 && connectsParameter(context, entry.target, entry.imported, position)) return true;
        const target = byRel.get(entry.target);
        if (target && connectsDirectly(target)) return true;
      }
    }
    return false;
  };
  if (app.some(isConnected)) return;
  includeDev = true;
  const devConnector = app.find(isConnected);
  const devGuard = (file) => {
    const guards = guardsOf.get(file.rel) ?? devGuards(file.scan);
    return guards.find((guard) => /connect/i.test(file.scan.code.slice(guard.from, guard.to))) ?? guards[0];
  };
  const devOnly = devConnector === undefined ? null : { rel: devConnector.rel, line: devConnector.scan.lineOf(devGuard(devConnector)?.at ?? 0) };
  const where = instances[0] ?? { rel: netRel, name: 'the error net', line: 1 };
  if (rootLayout?.skip && devOnly === null) {
    report.skip({ file: rootLayout.rel, rule: 'net-connected', message: rootLayout.skip });
    return;
  }
  const name = instances[0]?.name ?? 'appErrorNet';
  const fix = `In the composition root, before any provider renders and in every build, connect it: connectErrorLog(${name}, services.errorLog) (examples/connect-error-log.ts), or ${name}.connect(sink).`;
  if (devOnly !== null) {
    report.problem({ file: devOnly.rel, line: devOnly.line, rule: 'net-connected', message: `${where.name} is connected only under a development-only guard (__DEV__ or NODE_ENV): in release every report waits in its buffer and is lost`, fix });
    return;
  }
  report.problem({ file: where.rel, line: where.line, rule: 'net-connected', message: `nothing connects ${where.name} to the error log: every report waits in its buffer and is lost when the process ends`, fix });
}

// --- the entry: root layout or package.json main ---------------------------------------------------

/** The Expo Router root layout, or a SKIP reason when it is not yet created. */
function findRootLayout(root, layout) {
  const candidates = ['_layout.tsx', '_layout.ts', '_layout.jsx', '_layout.js'].map((name) => `${layout.routesDir}/${name}`);
  const found = candidates.find((candidate) => existsSync(join(root, candidate)));
  if (found) return { rel: found };
  return { rel: candidates[0], skip: notYetCreated(root, { file: candidates[0], owner: 'app-startup-and-bootstrap' }) };
}

/** Files that may install the net: a local package.json main (a custom entry), the root layout, App.tsx. */
function installCandidates(root, pkg, rootLayout) {
  const main = typeof pkg.main === 'string' ? pkg.main.replace(/^\.\//, '') : '';
  const local = main !== '' && !main.startsWith('expo-router') && !main.startsWith('node_modules/') ? [posix.normalize(main)] : [];
  const withExtensions = local.flatMap((rel) => ['', '.ts', '.tsx', '.js'].map((ext) => rel + ext));
  const fallbacks = rootLayout ? [rootLayout.rel] : ['index.ts', 'index.tsx', 'index.js', 'App.tsx', 'App.ts', 'App.js'];
  const existing = [...withExtensions, ...fallbacks].filter((rel, index, all) => all.indexOf(rel) === index && existsSync(join(root, rel)));
  return existing.length > 0 ? existing : [rootLayout ? rootLayout.rel : 'index.ts'];
}

function readScan(root, rel) {
  if (!existsSync(join(root, rel))) return null;
  const text = readFileSync(join(root, rel), 'utf8');
  return { text, scan: scanSource(text) };
}

function localImports(root, layout, rel, scan) {
  return importsOf(scan)
    .filter((entry) => !entry.typeOnly)
    .map((entry) => ({ ...entry, target: resolveImport(rel, entry.spec, { root, aliases: layout.aliases }) }))
    .filter((entry) => entry.target.kind === 'local' && entry.target.exists);
}

/** net-installed for the entry candidates; returns the installer modules found (their guards are checked too). */
function checkInstalled(root, layout, candidates, netRel, report) {
  const verdicts = candidates.map((rel) => installVerdict(root, layout, rel, netRel));
  const installers = verdicts.map((verdict) => verdict.installer).filter((rel) => rel !== null);
  if (verdicts.some((verdict) => verdict.problem === null)) return installers;
  const [first] = candidates;
  report.problem({ file: first, line: 1, rule: 'net-installed', message: `the entry ${verdicts[0].problem}`, fix: `Make the first app import of ${first} the installer: import '@/services/error-net/install-error-net'; (polyfill imports may precede it).` });
  return installers;
}

/** True when `rel` reaches the net module through at most `hops` value imports. */
function reachesNet(root, layout, rel, netRel, hops = 3) {
  let frontier = [rel];
  const seen = new Set(frontier);
  for (let depth = 0; depth <= hops && frontier.length > 0; depth += 1) {
    if (frontier.includes(netRel)) return true;
    const next = [];
    for (const file of frontier) {
      const read = readScan(root, file);
      if (read === null) continue;
      for (const { target } of localImports(root, layout, file, read.scan)) {
        if (!seen.has(target.path)) {
          seen.add(target.path);
          next.push(target.path);
        }
      }
    }
    frontier = next;
  }
  return frontier.includes(netRel);
}

/** True when the module calls install*() in its body (brace depth 0). */
function installsAtModuleScope(scan) {
  return [...scan.code.matchAll(/(?<![\w$])(?:[\w$]+\s*\.\s*)?install\w*\s*\(/g)].some((match) => braceDepthAt(scan.code, match.index) === 0);
}

/**
 * null when the entry's first app import installs the net: a side-effect import (polyfills may come
 * before it) of a module that installs at module scope and reaches the net. Imports are evaluated
 * before the importing module's body, so an install call in the entry's own body runs too late.
 */
function installVerdict(root, layout, rel, netRel) {
  const verdict = (problem, installer = null) => ({ problem, installer });
  const entry = readScan(root, rel);
  if (entry === null) return verdict('does not exist, so nothing installs the error net');
  const imports = localImports(root, layout, rel, entry.scan);
  const all = importsOf(entry.scan).filter((item) => !item.typeOnly);
  const firstBinding = all.find((item) => item.form !== 'side-effect');
  for (const item of imports.filter((entryImport) => entryImport.form === 'side-effect')) {
    const installer = readScan(root, item.target.path);
    if (installer === null || !installsAtModuleScope(installer.scan) || !reachesNet(root, layout, item.target.path, netRel)) continue;
    if (firstBinding === undefined || item.index < firstBinding.index) return verdict(null, item.target.path);
    return verdict(`installs the error net only after "${firstBinding.spec}" has loaded (import '${item.spec}' first)`, item.target.path);
  }
  if (!reachesNet(root, layout, rel, netRel)) return verdict(`does not import the error net (${netRel})`);
  if (installsAtModuleScope(entry.scan)) return verdict('installs the error net in its body, after every import has loaded (side-effect import an installer module first instead)');
  return verdict('imports the error net but never installs it');
}

// --- the root error boundary --------------------------------------------------------------------

function checkBoundary(root, layout, app, rootLayout, report) {
  if (rootLayout === null) {
    const boundary = app.find((file) => /\bcomponentDidCatch\s*\(/.test(file.scan.code));
    if (!boundary) {
      report.problem({ file: `${layout.srcDir}/`, line: 0, rule: 'root-boundary', message: 'no error boundary (componentDidCatch) wraps the app', fix: 'Wrap the root navigator in an error boundary class that records the error and shows the crash screen.' });
      return;
    }
    checkRecords(boundary.rel, boundary.scan, report);
    checkNoAutoRetry(boundary.rel, boundary.scan, report);
    return;
  }
  const entry = readScan(root, rootLayout.rel);
  if (entry === null) return;
  const impl = boundaryImplementation(root, layout, rootLayout.rel, entry);
  if (impl === null) {
    report.problem({ file: rootLayout.rel, line: 1, rule: 'root-boundary', message: 'the root layout exports no ErrorBoundary: a render error unmounts the whole app', fix: 'export const ErrorBoundary = createRouteErrorBoundary({ record, Fallback }); (templates/src/features/crash-recovery/).' });
    return;
  }
  checkRecordOption(rootLayout.rel, entry.scan, report);
  checkRecords(impl.rel, impl.scan, report);
  const checked = new Set();
  const retryCheck = (rel, scan) => {
    if (!scan || checked.has(rel)) return;
    checked.add(rel);
    checkNoAutoRetry(rel, scan, report);
  };
  retryCheck(impl.rel, impl.scan);
  // The app writes the fallback, so an automatic retry hides there more often than in the factory.
  for (const file of fallbackFiles(root, layout, rootLayout.rel, entry)) retryCheck(file.rel, file.scan);
}

/** The local file a name of the entry is imported from, read and scanned, or null. */
function importedFile(root, layout, entryRel, entry, name) {
  const imports = localImports(root, layout, entryRel, entry.scan);
  const hit = imports.find((item) => new RegExp(String.raw`\b${name.replace(/\$/g, '\\$')}\b`).test(entry.text.slice(entry.text.lastIndexOf('import', item.index), item.index)));
  return hit ? { rel: hit.target.path, ...readScan(root, hit.target.path) } : null;
}

/**
 * The file that defines the `Fallback` the root layout passes to its boundary factory (through its
 * import, or the layout itself when defined there), plus the .tsx components that file imports
 * (the crash screen), so an effect or timer that retries there is found too.
 */
function fallbackFiles(root, layout, entryRel, entry) {
  const option = /\bFallback\s*:\s*([A-Za-z_$][\w$]*)/.exec(entry.scan.code)?.[1] ?? (/[{,]\s*Fallback\s*[,}]/.test(entry.scan.code) ? 'Fallback' : null);
  if (option === null) return [];
  const fallback = importedFile(root, layout, entryRel, entry, option) ?? { rel: entryRel, ...entry };
  if (!fallback.scan) return [];
  const components = localImports(root, layout, fallback.rel, fallback.scan)
    .filter((item) => item.target.path.endsWith('.tsx'))
    .map((item) => ({ rel: item.target.path, ...readScan(root, item.target.path) }));
  return [fallback, ...components];
}

/** The file (and scan) whose code implements the root layout's ErrorBoundary export. */
function boundaryImplementation(root, layout, entryRel, entry) {
  const { code } = entry.scan;
  const imports = localImports(root, layout, entryRel, entry.scan);
  const reexport = /export\s*\{([^}]*)\}\s*from\s*(['"])/.exec(code);
  if (reexport && /\bErrorBoundary\b/.test(reexport[1])) {
    const item = imports.find((entryImport) => entryImport.index === reexport.index + reexport[0].length - 1);
    return item ? { rel: item.target.path, ...readScan(root, item.target.path) } : null;
  }
  if (/export\s+function\s+ErrorBoundary\b/.test(code)) return { rel: entryRel, scan: entry.scan };
  const assigned = /export\s+(?:const|let)\s+ErrorBoundary\b[^=]*=\s*([\w$]+)/.exec(code);
  if (assigned) return importedFile(root, layout, entryRel, entry, assigned[1]) ?? { rel: entryRel, scan: entry.scan };
  const listed = /export\s*\{([^}]*\bas\s+ErrorBoundary\b[^}]*)\}/.exec(code);
  if (listed) {
    const local = /([\w$]+)\s+as\s+ErrorBoundary\b/.exec(listed[1])?.[1] ?? '';
    return importedFile(root, layout, entryRel, entry, local) ?? { rel: entryRel, scan: entry.scan };
  }
  return null;
}

/** The body of the function at `from` (an arrow or a function expression): its text, or null. */
function functionBodyAt(code, from) {
  const head = /^(?:async\s+)?(?:function\b[^(]*\([^)]*\)\s*|(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*)/.exec(code.slice(from));
  if (!head) return null;
  let start = from + head[0].length;
  while (/\s/.test(code[start] ?? '')) start += 1;
  if (code[start] === '{') {
    const close = matchBracket(code, start);
    return close === -1 ? null : code.slice(start + 1, close);
  }
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return code.slice(start, i);
      depth -= 1;
    } else if (ch === ',' && depth === 0) return code.slice(start, i);
  }
  return code.slice(start);
}

/** The record: option the root layout hands its boundary factory must record: a call besides console.*. */
function checkRecordOption(rel, scan, report) {
  const { code } = scan;
  const fix = "Pass the error net's report: record: (error) => { appErrorNet.report({ source: 'render', error, isFatal: false }); }.";
  for (const match of code.matchAll(/\brecord\s*:\s*/g)) {
    const from = match.index + match[0].length;
    const reference = /^([A-Za-z_$][\w$.]*)\s*[,}\n]/.exec(code.slice(from));
    let recordsNothing;
    if (reference) recordsNothing = /^(?:noop|ignore\w*|swallow\w*|console\.\w+|undefined|null)$/.test(reference[1]);
    else {
      const body = functionBodyAt(code, from);
      if (body === null) continue;
      const calls = [...withoutDevLogs(body).matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\s*\(|[)\]]\s*\(/g)].filter((call) => !/^(if|for|while|switch|return|typeof|void|await)$/.test(call[1] ?? ''));
      recordsNothing = calls.length === 0;
    }
    if (recordsNothing) {
      report.problem({ file: rel, line: scan.lineOf(match.index), rule: 'boundary-records', message: 'the ErrorBoundary is given a record function that records nothing (no call besides console output, which never leaves the phone)', fix });
    }
  }
}

function checkRecords(rel, scan, report) {
  if (!scan) return;
  if (!RECORD_CALL.test(withoutDevLogs(scan.code))) {
    report.problem({ file: rel, line: 1, rule: 'boundary-records', message: 'the error boundary records nothing (Expo Router\'s own boundary does not log): a caught render error is invisible in release', fix: 'Record the error once when the boundary mounts: useEffect(() => { record(error); }, [error]).' });
  }
}

function checkNoAutoRetry(rel, scan, report) {
  if (!scan) return;
  const { code } = scan;
  const seen = new Set();
  for (const match of code.matchAll(/\b(useEffect|useLayoutEffect|useInsertionEffect|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|setImmediate)\s*\(/g)) {
    const args = callArgs(code, match.index + match[0].length - 1);
    if (!args) continue;
    const inner = code.slice(args.open, args.close);
    const called = RETRY_CALL.exec(inner);
    const handed = TIMERS.has(match[1]) ? RETRY_REFERENCE.exec(inner) : null;
    const hit = called ? { at: args.open + called.index, what: called[0].replace(/\s*\($/, '()').replace(/^\.\s*/, '').replace(/\s+/g, '').trim() } : handed ? { at: args.open, what: (handed[1] ?? handed[2]).replace(/\s+/g, '') } : null;
    if (!hit) continue;
    const line = scan.lineOf(hit.at);
    if (seen.has(line)) continue;
    seen.add(line);
    report.problem({ file: rel, line, rule: 'no-auto-retry', message: `the boundary retries by itself (${hit.what} in ${match[1]}): a render error that repeats becomes a crash loop`, fix: 'Leave the fallback only from its button (onRestart), never from an effect or a timer; that includes navigating to another screen.' });
  }
}

run(main);
