// server-state-source.mjs: the source model check-server-state works on (a helper, not an entry point).
// Each repo file is read once and lexed lazily with source-scan: `code` has comments and string
// contents blanked (same length, same line breaks), so a pattern never matches inside text or a
// comment, and the index of a match is the index in the raw text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { importsOf, isTestFile, matchBracket, scanSource } from './source-scan.mjs';

/** rel -> { rel, raw, code, scan, lineOf, imports, isTest } (the scan is computed on first use). */
export function loadSources(root, files) {
  const sources = new Map();
  for (const rel of files) {
    const raw = readFileSync(join(root, rel), 'utf8');
    let scan = null;
    const lazy = () => (scan ??= scanSource(raw));
    sources.set(rel, {
      rel,
      raw,
      isTest: isTestFile(rel),
      get scan() {
        return lazy();
      },
      get code() {
        return lazy().code;
      },
      lineOf: (index) => (index < 0 ? 1 : lazy().lineOf(index)),
      get imports() {
        return importsOf(lazy());
      },
    });
  }
  return sources;
}

/** Every match of a global RegExp on the blanked code: [{ index, match }]. */
export function codeMatches(src, pattern) {
  return [...src.code.matchAll(pattern)].map((match) => ({ index: match.index, match }));
}

/** True when the file imports `spec` (or a subpath of it), type-only imports included. */
export function importsPackage(src, spec) {
  return src.imports.some((entry) => entry.spec === spec || entry.spec.startsWith(`${spec}/`));
}

/** True when `rel` is `dir` itself or below it. */
export function isUnder(rel, dir) {
  return dir !== '' && (rel === dir || rel.startsWith(`${dir}/`));
}

/**
 * The object literal around `index`: the innermost `{ ... }` whose braces enclose it, as
 * { open, close } indexes into the code, or null at module level.
 */
export function enclosingObject(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const c = code[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) {
        const close = matchBracket(code, i);
        return close === -1 ? null : { open: i, close };
      }
      depth -= 1;
    }
  }
  return null;
}

/**
 * The top-level `key: value` entries of the object literal { open, close } in `code`:
 * [{ key, index, valueStart, valueEnd, value }] (value is the blanked code of the value).
 */
export function objectEntries(code, object) {
  const entries = [];
  let depth = 0;
  let start = object.open + 1;
  const flush = (end) => {
    const part = code.slice(start, end);
    const lead = part.length - part.trimStart().length;
    const match = /^(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(:)?/.exec(part.trimStart());
    if (match) {
      const keyIndex = start + lead;
      const valueStart = match[2] ? keyIndex + match[0].length : keyIndex;
      entries.push({ key: match[1], index: keyIndex, valueStart, valueEnd: end, value: code.slice(valueStart, end).trim() });
    }
    start = end + 1;
  };
  for (let i = object.open + 1; i < object.close; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) flush(i);
  }
  flush(object.close);
  return entries;
}

/** The entries of the object literal that holds the property starting at `index`, or []. */
export function siblingEntries(code, index) {
  const object = enclosingObject(code, index);
  return object === null ? [] : objectEntries(code, object);
}

/** [{ start, end }] of every `try { ... }` block that has a catch clause. */
export function tryBlocksWithCatch(code) {
  const blocks = [];
  for (const match of code.matchAll(/\btry\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);
    if (close !== -1 && /^\s*catch\b/.test(code.slice(close + 1, close + 40))) blocks.push({ start: open, end: close });
  }
  return blocks;
}

/** [{ start, end }] of the argument lists of calls to `callee` (a RegExp source). */
export function callArgumentRanges(code, callee) {
  const ranges = [];
  for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${callee}\\s*(?:<[^()]*>)?\\s*\\(`, 'g'))) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);
    if (close !== -1) ranges.push({ start: open, end: close, callStart: match.index });
  }
  return ranges;
}

/** [{ start, end, callStart }] of the argument lists of member calls `.name(...)` (any receiver). */
export function memberCallRanges(code, name) {
  const ranges = [];
  for (const match of code.matchAll(new RegExp(`\\.\\s*${name}\\s*(?:<[^()]*>)?\\s*\\(`, 'g'))) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(code, open);
    if (close !== -1) ranges.push({ start: open, end: close, callStart: match.index });
  }
  return ranges;
}

/** True when `index` lies inside one of the ranges. */
export function within(ranges, index) {
  return ranges.some((range) => index > range.start && index < range.end);
}

/** Brace depth at `index` (0 = module level, as far as braces tell). */
export function braceDepth(code, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') depth -= 1;
  }
  return depth;
}

/** The comments inside [from, to) of the raw text, joined (markers such as // no-cache-effect: live there). */
export function commentsBetween(src, from, to) {
  return src.scan.comments.filter((comment) => comment.index >= from && comment.index < to).map((comment) => comment.text).join('\n');
}

/** A reasoned marker comment `// <name>: <reason of 10+ characters>` inside [from, to). */
export function hasMarker(src, name, from, to) {
  return new RegExp(`//\\s*${name}:\\s*\\S.{9,}`).test(commentsBetween(src, from, to));
}
