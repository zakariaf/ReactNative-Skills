// app-source.mjs: small helpers for reading the app's TypeScript as text: comment masking,
// StyleSheet.create ranges, function and type ranges, imports and where they resolve, and deep
// comparison of JSON-like values.

import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { maskComments, resolveAlias } from '../check-lib.mjs';

export function readSource(absPath) {
  return existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
}

/** Comments become spaces (newlines kept), so a pattern never matches commented-out code. */
export function masked(source) {
  return maskComments(source);
}

/** The index just past the bracket that closes the one at `open` ('(' '[' or '{'), or -1. */
export function closingIndex(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The top-level comma-separated parts of an argument or parameter list (the text between its
 * parentheses), each with its offset: [{ text, at }]. Brackets, strings and generics (`Record<K, V>`,
 * no space before `<`; Prettier spaces a comparison) nest.
 */
export function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch) || (ch === '<' && /[\w$]/.test(list[i - 1] ?? ''))) depth += 1;
    else if (')]}'.includes(ch) || (ch === '>' && list[i - 1] !== '=' && depth > 0)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push({ text: list.slice(start, i), at: start });
      start = i + 1;
    }
  }
  if (list.slice(start).trim() !== '' || parts.length > 0) parts.push({ text: list.slice(start), at: start });
  return parts;
}

/** Character ranges of every `StyleSheet.create(...)` argument in masked source. */
export function styleSheetRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(/StyleSheet\.create\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const end = closingIndex(text, open);
    if (end > 0) ranges.push([open, end]);
  }
  return ranges;
}

export function inRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/** A repo folder in posix form; '' and '.' (an app with no src/, `@/*` -> `./*`) are the repo root. */
export function normalDir(dir) {
  const normal = posix.normalize(String(dir ?? '').replaceAll('\\', '/')).replace(/\/+$/, '');
  return normal === '' || normal === '.' || normal === './' ? '.' : normal.replace(/^\.\//, '');
}

/** Whether the repo-relative file `rel` lies in the folder `dir` (every file lies in the root '.'). */
export function within(rel, dir) {
  const folder = normalDir(dir);
  return folder === '.' || rel === folder || rel.startsWith(`${folder}/`);
}

/** The [start, end) range of `function <name>(...) { ... }` in masked source, or null. */
export function functionRange(text, name) {
  const head = new RegExp(`function ${name}\\s*\\(`).exec(text);
  if (head === null) return null;
  const close = closingIndex(text, head.index + head[0].length - 1);
  const open = close < 0 ? -1 : text.indexOf('{', close);
  const end = open < 0 ? -1 : closingIndex(text, open);
  return end < 0 ? null : [head.index, end];
}

/** The [start, end) range of `type <name> = { ... };` in masked source, or null. */
export function typeRange(text, name) {
  const head = new RegExp(`type ${name}\\s*=\\s*\\{`).exec(text);
  if (head === null) return null;
  const end = closingIndex(text, head.index + head[0].length - 1);
  return end < 0 ? null : [head.index, end];
}

/** Deep equality for JSON-like data; numbers compare within 1e-9. */
export function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => sameValue(a[key], b[key]));
  }
  return a === b;
}

/** The leaf paths whose values differ: [{ key: 'md' | 'body.fontSize', actual, expected }]. */
export function diffObject(actual, expected, prefix = '') {
  const out = [];
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = new Set([...Object.keys(isObject(expected) ? expected : {}), ...Object.keys(isObject(actual) ? actual : {})]);
  for (const key of keys) {
    const a = actual?.[key];
    const e = expected?.[key];
    const path = `${prefix}${key}`;
    if (isObject(a) && isObject(e)) out.push(...diffObject(a, e, `${path}.`));
    else if (!sameValue(a, e)) out.push({ key: path, actual: a, expected: e });
  }
  return out;
}

export function show(value) {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

/** 1-based line of the first match of `pattern` in `text`, else 1. */
export function lineOfPattern(text, pattern) {
  const index = text.search(pattern);
  return index < 0 ? 1 : text.slice(0, index).split('\n').length;
}

const STATIC_IMPORT = /\b(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*(['"])([^'"]+)\4/g;
const DYNAMIC_IMPORT = /\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

function namesOf(clause) {
  const names = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  for (const part of braces ? braces[1].split(',') : []) {
    const match = /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
    if (match && !match[1]) names.push({ imported: match[2], local: match[3] ?? match[2] });
  }
  const head = clause.replace(/\{[^}]*\}/, '').trim();
  const namespace = /\*\s*as\s+([\w$]+)/.exec(head)?.[1] ?? null;
  const defaultName = /^([\w$]+)\s*(?:,|$)/.exec(head)?.[1] ?? null;
  return { names, namespace, defaultName, isStar: head === '*' };
}

/**
 * Value imports and re-exports of masked source: [{ spec, index, names: [{ imported, local }],
 * namespace, defaultName, isWhole }]. Type-only imports are left out (they bundle nothing).
 * isWhole: a namespace import, a star re-export, require() or import() (every export is reachable).
 */
export function importsOf(text) {
  const out = [];
  for (const match of text.matchAll(STATIC_IMPORT)) {
    if (match[2]) continue;
    const { names, namespace, defaultName, isStar } = namesOf(match[3]);
    out.push({ spec: match[5], index: match.index, names, namespace, defaultName, isWhole: namespace !== null || isStar });
  }
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    out.push({ spec: match[2], index: match.index, names: [], namespace: null, defaultName: null, isWhole: true });
  }
  return out.sort((a, b) => a.index - b.index);
}

const CODE_EXTENSION = /\.(tsx?|jsx?|mjs|cjs|json)$/;
const bare = (rel) => posix.normalize(rel).replace(/^\.\//, '').replace(CODE_EXTENSION, '');

/** The tsconfig aliases, or the Expo template's `@/*` -> `<srcDir>/*` when the repo declares none. */
export function aliasesOf(layout) {
  return layout.aliases?.length > 0 ? layout.aliases : [{ pattern: '@/*', targets: [`${layout.srcDir}/*`] }];
}

/** Whether `spec`, imported from the repo file `fromRel`, names the repo file `target` (relative path or tsconfig alias). */
export function specifierNames(fromRel, spec, target, aliases) {
  const candidates = spec.startsWith('.') ? [posix.join(posix.dirname(fromRel), spec)] : (resolveAlias(spec, aliases) ?? []);
  return candidates.some((candidate) => bare(candidate) === bare(target));
}

/**
 * The expression that starts at `start` and runs to the next top-level `,` or `;`, or to the bracket
 * that closes the enclosing one (`{ duration: isSlow() ? 600 : 200 }` gives `isSlow() ? 600 : 200`).
 * Strings and nested brackets are skipped. { text, at } (`at`: the index of its first character).
 */
export function valueExpression(text, start, limit = text.length) {
  let depth = 0;
  let quote = null;
  let i = start;
  for (; i < limit; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) break;
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) break;
  }
  const raw = text.slice(start, i);
  const lead = raw.length - raw.trimStart().length;
  return { text: raw.trim(), at: start + lead };
}

/** `expr` with the inside of every string and every [index] blanked (same length), so only code remains. */
function codeOnly(expr) {
  let out = '';
  let quote = null;
  let square = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (quote !== null) {
      out += ' ';
      if (ch === '\\' && i + 1 < expr.length) {
        out += ' ';
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ' ';
    } else if (ch === '[') {
      square += 1;
      out += ch;
    } else if (ch === ']') {
      square -= 1;
      out += ch;
    } else out += square > 0 ? ' ' : ch;
  }
  return out;
}

const BRANCH_BEFORE = /(?:\?|:|\|\||\?\?|&&|^)$/;
const BRANCH_AFTER = /^(?:$|:|\?(?!\.)|\|\||\?\?|&&|\))/;

/** Whether the literal at [index, end) of `code` is a whole branch of a conditional or logical operator. */
function isBranch(code, index, end) {
  let before = code.slice(0, index).trimEnd();
  if (before.endsWith('-')) before = before.slice(0, -1).trimEnd();
  let groups = 0;
  while (before.endsWith('(') && !/[\w$)\]]\s*\($/.test(before)) {
    before = before.slice(0, -1).trimEnd();
    groups += 1;
  }
  let after = code.slice(end).trimStart();
  for (; groups > 0 && after.startsWith(')'); groups -= 1) after = after.slice(1).trimStart();
  return BRANCH_BEFORE.test(before) && BRANCH_AFTER.test(after);
}

/**
 * The non-zero number literals of an expression that are design values, not member accesses
 * (`RADII.md`, `SPACING[2]`) or string content. With `arithmetic` every such literal counts
 * (`index * 50`, `MOTION_MS.fast * 2`: a duration no token holds); without it only a literal that is
 * a whole branch of a conditional or logical operator (`isNarrow() ? 13 : 17`, `size || 12`), so
 * `AVATAR / 2` and `scale(14)` stay silent there.
 */
export function rawLiteralsIn(expr, { arithmetic }) {
  const code = codeOnly(expr);
  const found = [];
  for (const match of code.matchAll(/(?<![\w$.])(\d+(?:\.\d+)?)(?![\w$.])/g)) {
    if (Number(match[1]) === 0) continue;
    if (arithmetic || isBranch(code, match.index, match.index + match[1].length)) found.push(match[1]);
  }
  return found;
}

/**
 * The initializer of `const <name> = ...` in the same (masked) file: { kind: 'object', open, end }
 * for an object literal (a type annotation, `as const` and `satisfies` allowed), { kind: 'number',
 * at, value } for a plain number, { kind: 'string', at, value } for a plain string, else null. A
 * value imported from another module is never found here.
 */
export function constInitializer(text, name) {
  const head = new RegExp(`\\bconst\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=;]+)?=\\s*`).exec(text);
  if (head === null) return null;
  const start = head.index + head[0].length;
  if (text[start] === '{') {
    const end = closingIndex(text, start);
    return end < 0 ? null : { kind: 'object', open: start, end };
  }
  const number = /^(\d+(?:\.\d+)?)\s*(?:as\s+const\s*)?[;,\n]/.exec(text.slice(start));
  if (number) return { kind: 'number', at: start, value: number[1] };
  const string = /^(["'`])([^"'`$\\]*)\1\s*(?:as\s+const\s*)?[;,\n]/.exec(text.slice(start));
  return string ? { kind: 'string', at: start, value: string[2] } : null;
}

/** The initializer expression of `const <name> = ...;` in the same (masked) file, or null. */
export function constExpression(text, name) {
  const head = new RegExp(`\\bconst\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=;]+)?=\\s*`).exec(text);
  return head === null ? null : valueExpression(text, head.index + head[0].length).text;
}

/** The index just past the `>` that ends the JSX opening tag starting at `start` (`<Name ...>`), or -1. */
export function openingTagEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i + 1;
  }
  return -1;
}

/** The expression of the JSX attribute `name={...}` (or `name="..."`) in an opening tag, or null when absent. */
export function jsxAttribute(tag, name) {
  const head = new RegExp(`\\s${name}\\s*=\\s*`).exec(tag);
  if (head === null) return null;
  const start = head.index + head[0].length;
  if (tag[start] === '{') {
    const end = closingIndex(tag, start);
    return end < 0 ? '' : tag.slice(start + 1, end - 1).trim();
  }
  return /^(["'])([^"']*)\1/.exec(tag.slice(start))?.[0] ?? '';
}
