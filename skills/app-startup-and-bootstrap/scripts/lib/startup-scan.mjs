// startup-scan.mjs: small source analyses check-startup needs on top of source-scan.mjs: where a
// position sits (module scope, which function, which call it is an argument of), the JSX element
// spans of a component, and literal values of a const. Works on maskCode output (comments and
// literal contents blanked, positions kept). Zero dependencies.

const OPEN = { '(': ')', '{': '}', '[': ']' };
const CLOSE = new Set([')', '}', ']']);

/** Bracket depth before `index` (all three kinds together). */
export function depthAt(masked, index) {
  let depth = 0;
  for (let i = 0; i < index && i < masked.length; i += 1) {
    const ch = masked[i];
    if (OPEN[ch]) depth += 1;
    else if (CLOSE.has(ch)) depth -= 1;
  }
  return depth;
}

/** Start of the statement that holds `index`, at bracket depth zero. */
function statementStart(masked, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = masked[i];
    if (CLOSE.has(ch)) depth += 1;
    else if (OPEN[ch]) depth -= 1;
    if (depth === 0 && (ch === ';' || ch === '}')) return i + 1;
    if (depth < 0) return i + 1;
  }
  return 0;
}

/**
 * True when the code at `index` runs while the module is first evaluated: at bracket depth zero and
 * not inside an arrow function or function expression that starts earlier in the same statement.
 */
export function isModuleScope(masked, index) {
  if (depthAt(masked, index) !== 0) return false;
  const head = masked.slice(statementStart(masked, index), index);
  return !/=>|\bfunction\b/.test(head);
}

/** Index of the bracket closing the one at `open`, or -1. */
function closing(masked, open) {
  const want = OPEN[masked[open]];
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    const ch = masked[i];
    if (OPEN[ch]) depth += 1;
    else if (CLOSE.has(ch)) {
      depth -= 1;
      if (depth === 0) return ch === want ? i : -1;
    }
  }
  return -1;
}

/** End of an arrow's expression body that starts at `from`: the first , ; ) ] } at depth zero. */
function expressionEnd(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i];
    if (OPEN[ch]) depth += 1;
    else if (CLOSE.has(ch)) {
      if (depth === 0) return i;
      depth -= 1;
    } else if (depth === 0 && (ch === ',' || ch === ';')) return i;
  }
  return masked.length;
}

/** Start of an arrow's head (its parameter list or single parameter) for the "=>" at `arrow`. */
function arrowHeadStart(masked, arrow) {
  let i = arrow - 1;
  while (i >= 0 && /\s/.test(masked[i])) i -= 1;
  // A return type annotation, `(x): T =>`: step back to the ')' that closes the parameter list.
  const typed = /\)\s*:\s*[\w$.<>[\]|&\s,]*$/.exec(masked.slice(Math.max(0, i - 160), i + 1));
  if (masked[i] !== ')' && typed) i = Math.max(0, i - 160) + typed.index;
  if (masked[i] === ')') {
    let depth = 0;
    for (; i >= 0; i -= 1) {
      if (masked[i] === ')') depth += 1;
      else if (masked[i] === '(') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return 0;
  }
  while (i >= 0 && /[\w$]/.test(masked[i])) i -= 1;
  return i + 1;
}

/** What a function is: its name, or the call it is an argument of. */
function describe(masked, headStart) {
  let i = headStart - 1;
  while (i >= 0 && /\s/.test(masked[i])) i -= 1;
  if (masked.slice(Math.max(0, i - 5), i + 1) === 'async') {
    i -= 5;
    while (i >= 0 && /\s/.test(masked[i])) i -= 1;
  }
  const before = masked.slice(Math.max(0, i - 200), i + 1);
  const assigned = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*$/.exec(before);
  if (assigned) return { name: assigned[1], argumentOf: null };
  const property = /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(before);
  if (property) return { name: property[1], argumentOf: null };
  if (masked[i] === '(' || masked[i] === ',') {
    let depth = 0;
    for (let j = i; j >= 0; j -= 1) {
      const ch = masked[j];
      if (CLOSE.has(ch)) depth += 1;
      else if (OPEN[ch]) {
        if (depth === 0) {
          if (ch !== '(') break;
          const callee = /([A-Za-z_$][\w$.]*)\s*$/.exec(masked.slice(Math.max(0, j - 120), j));
          return { name: '(callback)', argumentOf: callee ? callee[1] : null };
        }
        depth -= 1;
      }
    }
  }
  return { name: '(anonymous)', argumentOf: null };
}

/**
 * Every function of a file: [{ name, argumentOf, start, end }] where start..end is the body (block or
 * expression). `argumentOf` names the callee when the function is passed straight to a call
 * (useEffect, useState, then, setTimeout); `name` is the declared or assigned name otherwise.
 */
export function functionRanges(masked) {
  const ranges = [];
  for (const match of masked.matchAll(/\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(<[^()]*>)?\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = closing(masked, open);
    if (close === -1) continue;
    const brace = masked.indexOf('{', close);
    if (brace === -1) continue;
    const between = masked.slice(close + 1, brace);
    if (/[;=]/.test(between.replace(/=>/g, ''))) continue;
    const end = closing(masked, brace);
    if (end === -1) continue;
    const named = match[1] ? { name: match[1], argumentOf: null } : describe(masked, match.index);
    ranges.push({ ...named, start: brace, end });
  }
  for (const match of masked.matchAll(/=>/g)) {
    const arrow = match.index;
    let body = arrow + 2;
    while (body < masked.length && /\s/.test(masked[body])) body += 1;
    const end = masked[body] === '{' ? closing(masked, body) : expressionEnd(masked, body);
    if (end === -1) continue;
    ranges.push({ ...describe(masked, arrowHeadStart(masked, arrow)), start: body, end });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** The innermost function whose body holds `index`, or null at module scope. */
export function innermostFunction(ranges, index) {
  let found = null;
  for (const range of ranges) {
    if (range.start <= index && index <= range.end && (found === null || range.start >= found.start)) found = range;
  }
  return found;
}

export const isComponentName = (name) => /^[A-Z]/.test(name);
export const isHookName = (name) => /^use[A-Z0-9]/.test(name);

/**
 * JSX element spans: [{ name, start, end, line }] where end is the end of the closing tag (or of the
 * self-closing tag). `tags` comes from source-scan's findJsxTags.
 */
export function jsxSpans(masked, tags) {
  return tags.map((tag) => {
    if (tag.selfClosing) return { name: tag.name, start: tag.start, end: tag.end };
    const escaped = tag.name.replace(/[.$]/g, '\\$&');
    const re = new RegExp(`<(/?)${escaped}(?![\\w.$])`, 'g');
    re.lastIndex = tag.end;
    let depth = 1;
    for (let match = re.exec(masked); match !== null; match = re.exec(masked)) {
      if (match[1] === '/') depth -= 1;
      else {
        const gt = masked.indexOf('>', match.index);
        if (gt !== -1 && masked[gt - 1] !== '/') depth += 1;
      }
      if (depth === 0) return { name: tag.name, start: tag.start, end: masked.indexOf('>', match.index) };
    }
    return { name: tag.name, start: tag.start, end: masked.length };
  });
}

/** The number a `const NAME = <number>` (underscores allowed) declares in `source`, or null. */
export function constNumber(source, name) {
  const match = new RegExp(`\\bconst\\s+${name}\\s*(?::\\s*number\\s*)?=\\s*([0-9][0-9_]*)\\s*;`).exec(source);
  return match ? Number(match[1].replaceAll('_', '')) : null;
}
