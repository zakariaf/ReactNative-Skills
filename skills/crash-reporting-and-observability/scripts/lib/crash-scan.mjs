// crash-scan.mjs: source helpers for check-crash-reporting.mjs (zero dependencies). Not a parser:
// comment-masked text plus bracket matching, which is enough for the SDK options object, the
// config plugin entry and the handful of calls the rules look for.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments, matchGlob } from '../check-lib.mjs';
import { extractBlock, topLevelEntries } from './object-literal.mjs';
import { importsOf, scanSource } from './source-scan.mjs';

export const SENTRY_PACKAGE = '@sentry/react-native';

/** Reads a repo file as text, or null when it does not exist. */
export function readMaybe(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Parses JSON text; returns { value } or { error }. */
export function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** 1-based line of `index` in `text`. */
export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** 1-based line of the first match of `pattern` (string or RegExp) in `text`, else 1. */
export function lineOfMatch(text, pattern) {
  const index = typeof pattern === 'string' ? text.indexOf(pattern) : text.search(pattern);
  return index < 0 ? 1 : lineAt(text, index);
}

/**
 * A scanned source file: the raw text, `masked` (comments blanked, strings kept), `code` (comments
 * and strings blanked) and its imports.
 */
export function scanFile(text) {
  const scan = scanSource(text);
  return { text, masked: maskComments(text), code: scan.code, imports: importsOf(scan), lineOf: scan.lineOf };
}

/** How the file names the Sentry SDK: the namespace alias and the named imports (local -> imported). */
export function sentryBindings(masked) {
  const namespaces = [];
  const named = new Map();
  const quoted = SENTRY_PACKAGE.replace('/', '\\/');
  for (const match of masked.matchAll(new RegExp(`import\\s+\\*\\s+as\\s+([\\w$]+)\\s+from\\s+['"]${quoted}['"]`, 'g'))) {
    namespaces.push(match[1]);
  }
  for (const match of masked.matchAll(new RegExp(`import\\s+(?!type\\b)\\{([^}]*)\\}\\s*from\\s+['"]${quoted}['"]`, 'g'))) {
    for (const part of match[1].split(',')) {
      const [imported, local] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      if (imported) named.set((local ?? imported).trim(), imported.trim());
    }
  }
  return { namespaces, named };
}

/** Indexes (in `code`) of calls of the SDK function `name`: `Sentry.name(` or a named import. */
export function sdkCalls(code, bindings, name) {
  const found = [];
  for (const ns of bindings.namespaces) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${ns}\\s*\\.\\s*${name}\\s*\\(`, 'g'))) found.push(match.index);
  }
  for (const [local, imported] of bindings.named) {
    if (imported !== name) continue;
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${local}\\s*\\(`, 'g'))) found.push(match.index);
  }
  return found.sort((a, b) => a - b);
}

/** Brace depth at `index` of blanked code: 0 means module scope. */
export function braceDepth(code, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') depth -= 1;
  }
  return depth;
}

/** The text of the first argument of the call whose `(` is the first one at or after `index`. */
export function firstArgument(masked, index) {
  const open = masked.indexOf('(', index);
  if (open < 0) return null;
  const block = extractBlock(masked, open);
  if (!block) return null;
  const entries = topLevelEntriesOfArgs(block.inner);
  return entries[0] ?? null;
}

function topLevelEntriesOfArgs(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < inner.length && inner[i] !== quote) i += inner[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * The options object an init call receives: an object literal, a local `const name = { ... }`, or
 * the object a local function returns (`sentryOptions(dsn, config)` -> `function sentryOptions`).
 * Returns { inner, index } (index of the "{" in `masked`) or null.
 */
export function resolveOptionsObject(masked, argument) {
  if (argument === null) return null;
  if (argument.startsWith('{')) {
    const at = masked.indexOf(argument);
    return objectAt(masked, at);
  }
  const call = /^([\w$]+)\s*\(/.exec(argument);
  if (call) {
    const fn = new RegExp(`function\\s+${call[1]}\\s*\\(`).exec(masked) ?? new RegExp(`(?:const|let)\\s+${call[1]}\\s*=`).exec(masked);
    if (!fn) return null;
    const bodyOpen = findBodyOpen(masked, fn.index);
    if (bodyOpen < 0) return null;
    const body = extractBlock(masked, bodyOpen);
    if (!body) return null;
    const returns = [...body.inner.matchAll(/\breturn\s*\{/g)];
    const last = returns.at(-1);
    if (!last) return null;
    return objectAt(masked, bodyOpen + 1 + last.index + last[0].length - 1);
  }
  const name = /^([\w$]+)$/.exec(argument);
  if (name) {
    const decl = new RegExp(`(?:const|let)\\s+${name[1]}\\b[^=]*=\\s*\\{`).exec(masked);
    if (!decl) return null;
    return objectAt(masked, decl.index + decl[0].length - 1);
  }
  return null;
}

function objectAt(masked, at) {
  if (at < 0 || masked[at] !== '{') return null;
  const block = extractBlock(masked, at);
  return block ? { inner: block.inner, index: at } : null;
}

/** The "{" that opens a function body after `from`, skipping the parameter list and return type. */
export function findBodyOpen(masked, from) {
  const open = masked.indexOf('(', from);
  if (open < 0) return -1;
  const params = extractBlock(masked, open);
  if (!params) return -1;
  let i = params.close + 1;
  let depth = 0;
  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '<' || ch === '(' || ch === '[') depth += 1;
    else if ((ch === '>' && masked[i - 1] !== '=') || ch === ')' || ch === ']') depth -= 1;
    else if (ch === '{' && depth === 0) {
      // `: { a: string }` return types are rare here; `=> {` and `) {` open the body.
      const before = masked.slice(params.close + 1, i).trim();
      if (before === '' || before.endsWith('=>') || /^:\s*[\w$.<>[\]|&\s,]+$/.test(before) || /^:\s*[\w$.<>[\]|&\s,]+=>$/.test(before)) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * The body of the adapter's exported factory (`export function create*Adapter(` or
 * `export const create*Adapter = (...) =>`) in blanked code: { name, open, close } or null.
 */
export function factoryBody(code) {
  const fn = /export\s+(?:async\s+)?function\s+(create[\w$]*Adapter)\s*[(<]/.exec(code) ?? /export\s+const\s+(create[\w$]*Adapter)\s*(?::[^=]+)?=\s*(?:async\s*)?[(<]/.exec(code);
  if (!fn) return null;
  const open = findBodyOpen(code, fn.index + fn[0].length - 1);
  if (open < 0) return null;
  const block = extractBlock(code, open);
  return block ? { name: fn[1], open, close: block.close } : null;
}

const CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/** True when the "{" at `index` of blanked code opens a function body (arrow, function, method). */
function opensFunctionBody(code, index) {
  const before = code.slice(0, index).trimEnd();
  if (before.endsWith('=>')) return true;
  // `): ReturnType {` (a control statement has no return type).
  if (/\)\s*:\s*[\w$.<>[\]|&\s,]+$/.test(before)) return true;
  if (!before.endsWith(')')) return false;
  let depth = 0;
  let i = before.length - 1;
  for (; i >= 0; i -= 1) {
    if (before[i] === ')') depth += 1;
    else if (before[i] === '(') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const word = /([\w$]+)\s*$/.exec(before.slice(0, Math.max(i, 0)));
  return !(word && CONTROL_WORDS.has(word[1]));
}

/**
 * True when the innermost function around `index` is the factory body itself: the call runs
 * when the factory runs (directly or inside an if/try block), not in a function it defines.
 * Heuristic: brace-opened nested functions and arrow/function expressions earlier in the same
 * statement count as nested.
 */
export function runsInFactoryBody(code, factory, index) {
  if (index <= factory.open || index >= factory.close) return false;
  const stack = [];
  for (let i = factory.open + 1; i < index; i += 1) {
    if (code[i] === '{') stack.push(opensFunctionBody(code, i));
    else if (code[i] === '}') stack.pop();
  }
  if (stack.some(Boolean)) return false;
  let start = index - 1;
  while (start > factory.open && !';{}'.includes(code[start])) start -= 1;
  return !/=>|\bfunction\b/.test(code.slice(start + 1, index));
}

/** The top-level entries of an object's inner text as a Map key -> { value, offset }. */
export function entryMap(inner) {
  const map = new Map();
  for (const entry of topLevelEntries(inner)) map.set(entry.key, entry);
  return map;
}

/** True when `rel` is matched by a .gitignore line (simple gitignore subset; negations honoured). */
export function isGitIgnored(root, rel) {
  const text = readMaybe(root, '.gitignore');
  if (text === null) return false;
  let ignored = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    const pattern = (negate ? line.slice(1) : line).replace(/^\//, '').replace(/\/$/, '');
    if (matchGlob(rel, pattern)) ignored = !negate;
  }
  return ignored;
}

/** Local imported binding names of a scanned file (from relative or alias specifiers). */
export function localImportNames(masked) {
  const names = new Set();
  for (const match of masked.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]((?:\.|@\/)[^'"]*)['"]/g)) {
    for (const part of match[1].split(',')) {
      const local = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1)?.trim();
      if (local) names.add(local);
    }
  }
  for (const match of masked.matchAll(/import\s+([\w$]+)\s+from\s*['"]((?:\.|@\/)[^'"]*)['"]/g)) names.add(match[1]);
  return names;
}
