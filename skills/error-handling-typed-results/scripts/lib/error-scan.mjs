// error-scan.mjs: the source scans both checkers of this skill share (a helper, not an entry point).
// Everything works on scanSource() output, where comments and string contents are blanked, so a
// regex never matches inside text. Heuristic by design: good enough for review-style checks.
//
//   readAppSources(root, srcDir)          [{ rel, text, scan, isTest }] for every .ts/.tsx under srcDir
//   catchBlocks(scan)                     [{ index, line, open, close, binding }]
//   promiseCatches(scan)                  [{ index, line, argOpen, argClose, body: { kind, from, to, name, param } }]
//   tryBlocks(scan)                       [{ index, open, close, hasCatch }]
//   failureBranches(scan)                 [{ index, open, close }] for if (!x.ok) { ... } and friends
//   guardedRanges(scan, pattern)          [{ open, close }] blocks opened by a pattern ending in "{"
//   braceDepthAt(code, index)             { } nesting depth at an index (0 = module top level)
//   isHandledBody(code, from, to, name)   a catch body throws, calls err(...) or passes the caught value on
//   isHandledExpression(...)              the same for an expression-bodied .catch handler
//   withoutDevLogs(code)                  console.* and logger.debug/trace/verbose calls blanked
//   repoDependsOn(root, pkg, name)        the root or any workspace package.json lists the dependency
//   hasMarker(text, from, to, marker)     a `// <marker>` comment between two indexes
//   callArgs(code, open)                  { open, close } of a call's argument list, or null

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readWorkspaces, walkRepo } from '../check-lib.mjs';
import { isTestFile, matchBracket, scanSource } from './source-scan.mjs';

/** Every TypeScript source under srcDir (declaration files left out), scanned. */
export function readAppSources(root, srcDir) {
  const prefix = srcDir === '.' || srcDir === '' ? '' : `${srcDir.replace(/\/$/, '')}/`;
  return walkRepo(root, { include: ['*.ts', '*.tsx'] })
    .filter((rel) => rel.startsWith(prefix) && !rel.endsWith('.d.ts'))
    .map((rel) => {
      const text = readFileSync(join(root, rel), 'utf8');
      return { rel, text, scan: scanSource(text), isTest: isTestFile(rel) };
    });
}

/** `catch (binding) { ... }` and `catch { ... }` blocks. */
export function catchBlocks(scan) {
  const out = [];
  for (const match of scan.code.matchAll(/\bcatch\s*(\(\s*([A-Za-z_$][\w$]*)?[^)]*\))?\s*\{/g)) {
    if (/\.\s*$/.test(scan.code.slice(Math.max(0, match.index - 3), match.index))) continue;
    const open = match.index + match[0].length - 1;
    const close = matchBracket(scan.code, open);
    if (close === -1) continue;
    out.push({ index: match.index, line: scan.lineOf(match.index), open, close, binding: match[2] ?? null });
  }
  return out;
}

/** The argument list of the call whose "(" is at `open`. */
export function callArgs(code, open) {
  const close = matchBracket(code, open);
  return close === -1 ? null : { open, close };
}

/**
 * `.catch(handler)` calls. body: { kind: 'block', from, to } for a function with a block body,
 * { kind: 'expr', from, to } for an expression-bodied arrow, { kind: 'ref', name } for a reference.
 */
export function promiseCatches(scan) {
  const out = [];
  const { code } = scan;
  for (const match of code.matchAll(/\.\s*catch\s*\(/g)) {
    const argOpen = match.index + match[0].length - 1;
    const args = callArgs(code, argOpen);
    if (!args) continue;
    const inner = code.slice(argOpen + 1, args.close);
    out.push({ index: match.index, line: scan.lineOf(match.index), argOpen, argClose: args.close, body: handlerBody(code, argOpen + 1, inner) });
  }
  return out;
}

/** The first parameter's name of a handler's parameter text (`(error: unknown)`, `error`), or null. */
function firstParam(params) {
  return /^\s*\(?\s*([A-Za-z_$][\w$]*)/.exec(params)?.[1] ?? null;
}

function handlerBody(code, start, inner) {
  const trimmed = inner.trim();
  const lead = inner.length - inner.trimStart().length;
  if (/^[A-Za-z_$][\w$.]*$/.test(trimmed)) return { kind: 'ref', name: trimmed, param: null };
  const fn = /^(?:async\s+)?function\b[^(]*\(([^)]*)\)[^{]*\{/.exec(trimmed);
  if (fn) {
    const open = start + lead + fn[0].length - 1;
    return { kind: 'block', from: open, to: matchBracket(code, open), param: firstParam(fn[1]) };
  }
  const arrow = inner.indexOf('=>');
  if (arrow === -1) return { kind: 'expr', from: start + lead, to: start + inner.length, param: null };
  const param = firstParam(inner.slice(0, arrow).replace(/^\s*async\b/, ''));
  let bodyStart = start + arrow + 2;
  while (/\s/.test(code[bodyStart] ?? '')) bodyStart += 1;
  if (code[bodyStart] === '{') return { kind: 'block', from: bodyStart, to: matchBracket(code, bodyStart), param };
  return { kind: 'expr', from: bodyStart, to: start + inner.length, param };
}

/** `try { ... }` blocks and whether a catch clause follows. */
export function tryBlocks(scan) {
  const out = [];
  for (const match of scan.code.matchAll(/\btry\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(scan.code, open);
    if (close === -1) continue;
    out.push({ index: match.index, open, close, hasCatch: /^\s*catch\b/.test(scan.code.slice(close + 1, close + 40)) });
  }
  return out;
}

/** Blocks opened by `pattern` (a regex source whose match ends at the opening "{"). */
export function guardedRanges(scan, pattern) {
  const out = [];
  for (const match of scan.code.matchAll(new RegExp(pattern, 'g'))) {
    const open = match.index + match[0].length - 1;
    if (scan.code[open] !== '{') continue;
    const close = matchBracket(scan.code, open);
    if (close !== -1) out.push({ index: match.index, open, close });
  }
  return out;
}

/** `if (!result.ok) {`, `if (result.ok === false) {`, `if (!ok) {` and the else of `if (x.ok) {...} else {`. */
export function failureBranches(scan) {
  const ranges = [
    ...guardedRanges(scan, String.raw`\bif\s*\(\s*!\s*[\w$.]*\bok\s*\)\s*\{`),
    ...guardedRanges(scan, String.raw`\bif\s*\(\s*[\w$.]*\.ok\s*===?\s*false\s*\)\s*\{`),
  ];
  for (const ok of guardedRanges(scan, String.raw`\bif\s*\(\s*[\w$.]*\.ok\s*\)\s*\{`)) {
    const tail = /^\s*else\s*\{/.exec(scan.code.slice(ok.close + 1, ok.close + 30));
    if (!tail) continue;
    const open = ok.close + 1 + tail[0].length - 1;
    const close = matchBracket(scan.code, open);
    if (close !== -1) ranges.push({ index: ok.index, open, close });
  }
  return ranges;
}

/** Nesting depth of { } at `index` (parentheses and brackets ignored). */
export function braceDepthAt(code, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') depth -= 1;
  }
  return depth;
}

/** Words before a "(" that open a condition, a grouping or a declaration, not a call. */
const NOT_CALLS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'typeof', 'await', 'void',
  'delete', 'in', 'of', 'instanceof', 'case', 'else', 'do', 'yield', 'throw',
]);

/**
 * Output nobody reads on a user's phone: `console.<method>(...)` and the debug/trace/verbose level of
 * any logger (`logger.debug(...)`, `this.log.trace(...)`), which release builds drop by convention.
 */
const DEV_LOG_CALL = /(?<![\w$.])(?:console|[\w$]+(?:\s*\??\.\s*[\w$]+)*\s*\??\.\s*(?:debug|trace|verbose))\s*(?:\??\.\s*\w+\s*)?\(/g;

/** Blank every console or debug-level log call, so it does not count as handling. */
export function withoutDevLogs(code) {
  let out = code;
  for (const match of code.matchAll(DEV_LOG_CALL)) {
    if (/^console\s*\($/.test(match[0])) continue; // console(...) is not a console method call
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);
    if (close === -1) continue;
    out = out.slice(0, match.index) + ' '.repeat(close + 1 - match.index) + out.slice(close + 1);
  }
  return out;
}

/** Kept for callers that only strip console calls (older name). */
export const withoutConsoleCalls = withoutDevLogs;

const escapeName = (name) => name.replace(/\$/g, '\\$');

/** True when the "{" at `open` starts a block (a function body, an if/else/try body), not an object literal. */
function opensBlock(body, open) {
  const before = body.slice(0, open).trimEnd();
  return before === '' || /(?:=>|[)};{]|(?<![\w$.])(?:else|try|finally|do))$/.test(before);
}

/**
 * True when the "(" that encloses `index` (through object and array literals, never out of a block) is
 * a call's argument list: record(error), onError?.(error), record({ error }), make()(error).
 */
function insideCallArguments(body, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = body[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      if (ch === '{' && opensBlock(body, i)) return false; // the value is a statement of its own block
      if (ch !== '(') continue; // an object or array literal: look further out
      const before = body.slice(0, i).trimEnd().replace(/\?\.$/, '');
      const callee = /([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?$/.exec(before);
      if (callee && !NOT_CALLS.has(callee[1])) return true;
      if (/[)\]]$/.test(before)) return true; // make()(error), handlers[0](error)
      // a grouping parenthesis or a condition: look further out
    }
  }
  return false;
}

/** [from, to) of each `return ...` and assignment right-hand side, up to its ";" or the end of its block. */
function valueRanges(body) {
  const ranges = [];
  for (const match of body.matchAll(/\breturn\b|(?<![=!<>+\-*/%&|^?])=(?![=>])/g)) {
    const from = match.index + match[0].length;
    let depth = 0;
    let to = body.length;
    for (let i = from; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) {
          to = i;
          break;
        }
        depth -= 1;
      } else if (ch === ';' && depth === 0) {
        to = i;
        break;
      }
    }
    ranges.push([from, to]);
  }
  return ranges;
}

/**
 * True when the caught value goes somewhere: passed to a call (record, report, a mapper, reject, a
 * state setter) or returned or assigned as a whole value (`return { kind, cause: error }`). A test
 * on it (`error instanceof X`, `error.name === ...`) passes nothing on.
 */
export function passesOn(body, name) {
  const pattern = new RegExp(String.raw`(?<![\w$.])${escapeName(name)}(?![\w$])`, 'g');
  const ranges = valueRanges(body);
  for (const match of body.matchAll(pattern)) {
    const after = body.slice(match.index + name.length);
    if (/^\s*:(?!:)/.test(after) && /[{,]\s*$/.test(body.slice(0, match.index))) continue; // an object key
    if (insideCallArguments(body, match.index)) return true;
    const isWholeValue = /^\s*(?:[;,)}\]]|$)/.test(after);
    if (isWholeValue && ranges.some(([from, to]) => match.index >= from && match.index < to)) return true;
  }
  return false;
}

/**
 * A handler body handles the error when, after console and debug-level log calls are removed, it
 * throws, maps it to a Result (`err(...)`), or passes the caught value on (see passesOn). A catch
 * without a binding can only map or throw: `catch { return null; }` loses the error.
 */
export function handlesError(body, binding) {
  const kept = withoutDevLogs(body);
  if (/\bthrow\b/.test(kept)) return true;
  if (/(?<![\w$.])err\s*\(/.test(kept)) return true;
  return binding !== null && binding !== undefined && passesOn(kept, binding);
}

/** handlesError over the inside of the block whose braces are at `from` and `to`. */
export function isHandledBody(code, from, to, binding = null) {
  return handlesError(code.slice(from + 1, to), binding);
}

/** An expression-bodied handler (`(error) => expr`) handles the error when `return expr;` would. */
export function isHandledExpression(code, from, to, binding = null) {
  return handlesError(`return ${code.slice(from, to)};`, binding);
}

/** An expression body (`() => expr`) that does nothing: undefined, null, void 0, {}, [], a literal, or console.*(). */
export function isEmptyExpression(code, from, to) {
  const expr = code.slice(from, to).trim().replace(/^\(\s*([\s\S]*?)\s*\)$/, '$1');
  if (/^(undefined|null|void\s+0|\{\s*\}|\[\s*\]|true|false|\d+|(['"`])\s*\2|)$/.test(expr)) return true;
  return withoutDevLogs(expr).trim() === '';
}

/** True when a `// <marker>` line comment sits between `from` and `to` in the original text. */
export function hasMarker(text, from, to, marker) {
  return text.slice(Math.max(0, from), to).split('\n').some((line) => line.includes(`// ${marker}`));
}

/** The text of package.json, parsed, or null. */
export function readPackageJson(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { invalid: true };
  }
}

/** True when the package is a dependency or devDependency. */
export function hasDependency(pkg, name) {
  return Boolean(pkg && (pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined));
}

/** True when the root package.json or any workspace's (package.json "workspaces") depends on the package. */
export function repoDependsOn(root, pkg, name) {
  if (hasDependency(pkg, name)) return true;
  return readWorkspaces(root).some((workspace) => hasDependency(workspace.manifest, name));
}
