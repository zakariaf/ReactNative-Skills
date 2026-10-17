// lib/background-scan.mjs: the scanning helpers of check-background-tasks.mjs. They work on
// source-scan's blanked code (comments and string contents replaced by spaces, positions kept), so
// a call or a brace inside a string or a comment is never seen.

import { findClosing } from './source-scan.mjs';

const CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Calls of `callee`: [{ start, open, close }]. `callee` is an identifier (matched as a whole word,
 * also as a member: TaskManager.defineTask) unless `raw` is set (a RegExp source). `generic`
 * allows a type argument list before the parenthesis: defineBackgroundJob<Deps>(.
 */
export function callsOf(code, callee, { raw = false, generic = false } = {}) {
  const name = raw ? callee : `(?<![\\w$])${escapeRegExp(callee)}`;
  const typeArgs = generic ? '(?:\\s*<[^()]*?>)?' : '';
  const re = new RegExp(`${name}${typeArgs}\\s*\\(`, 'g');
  const calls = [];
  for (const match of code.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(code, open);
    if (close !== -1) calls.push({ start: match.index, open, close });
  }
  return calls;
}

/** The top-level arguments between `open` and `close`: [{ start, end, text }] (start skips spaces). */
export function splitArguments(code, open, close) {
  const args = [];
  let depth = 0;
  let from = open + 1;
  const push = (to) => {
    let start = from;
    while (start < to && /\s/.test(code[start])) start += 1;
    if (start < to) args.push({ start, end: to, text: code.slice(start, to) });
  };
  for (let i = open + 1; i < close; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  push(close);
  return args;
}

/** The `key: value` entries at the top level of the object literal opening at `brace`. */
export function objectEntries(code, brace) {
  const close = findClosing(code, brace);
  const entries = {};
  if (close === -1) return entries;
  for (const part of splitArguments(code, brace, close)) {
    const match = /^([A-Za-z_$][\w$]*)\s*:\s*/.exec(part.text);
    if (!match) continue;
    const valueStart = part.start + match[0].length;
    entries[match[1]] = { valueStart, text: code.slice(valueStart, part.end).trim() };
  }
  return entries;
}

/** Index of the "(" matching the ")" at `close`, scanning backwards, or -1. */
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

/** True when the "{" at `brace` opens a function body (function, method, arrow), not a block or an object. */
function opensFunctionBody(code, brace) {
  let k = brace - 1;
  while (k >= 0 && /\s/.test(code[k])) k -= 1;
  if (k >= 1 && code[k] === '>' && code[k - 1] === '=') return true;
  if (code[k] === ')') {
    const open = openingParen(code, k);
    if (open === -1) return false;
    const word = /([A-Za-z_$][\w$]*)\s*$/.exec(code.slice(Math.max(0, open - 40), open));
    return !(word && CONTROL_WORDS.has(word[1]));
  }
  // A return type annotation: function load(): Promise<void> {  or  run(): Outcome {
  const before = code.slice(Math.max(0, brace - 300), brace);
  const boundary = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
  const tail = before.slice(boundary + 1);
  return /\)\s*:\s*[^=;]+$/.test(tail) && !/=\s*$/.test(tail);
}

/** Where the expression body of an arrow that starts at `from` ends (a top-level , ; or closer). */
function expressionEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return i;
  }
  return code.length;
}

/** Every function body of a file as [start, end] index pairs: block bodies and arrow expression bodies. */
export function functionRanges(code) {
  const ranges = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '{' && opensFunctionBody(code, i)) {
      const end = findClosing(code, i);
      if (end !== -1) ranges.push([i, end]);
    } else if (code[i] === '=' && code[i + 1] === '>') {
      let j = i + 2;
      while (j < code.length && /\s/.test(code[j])) j += 1;
      if (code[j] !== '{') ranges.push([j, expressionEnd(code, j)]);
    }
  }
  return ranges;
}

/** The smallest range that contains `index`, or null at module scope. */
export function innermostRange(ranges, index) {
  let best = null;
  for (const range of ranges) {
    if (range[0] < index && index < range[1] && (best === null || range[1] - range[0] < best[1] - best[0])) best = range;
  }
  return best;
}

/** The value of a plain number expression (12 * 60, 20_000, (5 + 10)), or null. */
export function evaluateNumber(expression) {
  const text = expression.trim().replace(/\s+as\s+const$/, '');
  if (text === '' || !/^[\d_\s*+().]+$/.test(text) || !/\d/.test(text)) return null;
  try {
    const value = Function(`"use strict"; return (${text.replaceAll('_', '')});`)();
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
