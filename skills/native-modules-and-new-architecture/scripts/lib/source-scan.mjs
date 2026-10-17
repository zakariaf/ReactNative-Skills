// source-scan.mjs: a small, dependency-free lexer and scanner for TypeScript and TSX source (a helper,
// not an entry point). One canonical copy, synced into every skill that declares it.
//
// The lexer (comments, strings, templates, regex literals):
//   scanSource(text) returns
//     code         the source with comments AND string/template contents blanked (quotes kept),
//                  same length and same line breaks, so regexes on it never match inside text
//     codeKeep     the source with only comments blanked (strings kept), for line counting
//     comments     [{ index, end, text, line }]
//     strings      [{ index, end, quote, value, parts, line }]   quote is ' " or `; for templates
//                  `parts` holds the static chunks and `value` joins them with ${}
//     stringAt     Map of string start index -> string entry
//     lineOf(i)    1-based line of a character index
//   makeLineOf(text), matchBracket(code, open), importsOf(scan) [{ spec, index, line, form, typeOnly }],
//   codeLineCount(codeKeep, from, to), functionsOf(scan), paramListsOf(scan), typeRegionsOf(code),
//   countParams(list)
//
// JSX and call helpers (on maskCode() output: comments and literal contents blanked):
//   maskCode(source), findClosing(masked, index), findJsxTags(source, masked) [{ name, start, end,
//   attrsFrom, attrsTo, selfClosing }], jsxAttributes(source, tag, masked) Map name -> { kind:
//   'string' | 'expr' | 'bool' | 'spread', value, index }, literalOf(attr), findCalls(masked, callee)
//   [{ start, open, close }], findImports(source, masked) [{ from, index, text }]
//
// Small helpers: hasWorkletDirective(source), valueImports(source) [{ spec, index }] (type-only
// imports left out), balancedParens(source, open), openingTag(source, index), isTestFile(rel),
// readRepoFile(root, rel)
//
// Import resolution (tsconfig "paths" and workspace package names, with extension and platform probing):
//   resolveImport(fromRel, spec, { root, aliases, extensions, platforms }) ->
//     { kind: 'external' | 'local', spec, path, exists }
//   resolveSpecifier(fromRel, spec, options) -> the repo-relative file, or null for a package
//
// Heuristics (good enough for lint-style checks, not a full parser):
//   - a quote directly after a letter or digit is JSX text (an apostrophe), not a string;
//   - "/" starts a regex literal after an operator, an opening bracket or a keyword.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { readTsconfigPaths, readWorkspaces, resolveAlias } from '../check-lib.mjs';

const OPENERS = { '(': ')', '{': '}', '[': ']' };

const IDENT = /[A-Za-z0-9_$]/;
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'else', 'do']);

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function makeLineOf(text) {
  const starts = lineStarts(text);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export function scanSource(text) {
  const n = text.length;
  const code = text.split('');
  const keep = text.split('');
  const comments = [];
  const strings = [];
  const lineOf = makeLineOf(text);
  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < n; k += 1) if (arr[k] !== '\n') arr[k] = ' ';
  };
  // Stack of open template literals; each entry counts the braces opened inside its ${ }.
  const templates = [];
  let last = '';
  let i = 0;

  const readTemplate = (start, entry) => {
    // Reads template text from `start` until the closing backtick or the next "${".
    let j = start;
    while (j < n && text[j] !== '`') {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === '$' && text[j + 1] === '{') break;
      j += 1;
    }
    entry.parts.push(text.slice(start, Math.min(j, n)));
    blank(code, start, j);
    if (j >= n || text[j] === '`') {
      entry.end = Math.min(j + 1, n);
      entry.value = entry.parts.join('${}');
      strings.push(entry);
      last = 'x';
      return { next: j + 1, open: false };
    }
    templates.push({ entry, depth: 0 });
    last = '{';
    return { next: j + 2, open: true };
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const stop = text.indexOf('\n', i) === -1 ? n : text.indexOf('\n', i);
      comments.push({ index: i, end: stop, text: text.slice(i, stop), line: lineOf(i) });
      blank(code, i, stop);
      blank(keep, i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? n : close + 2;
      comments.push({ index: i, end: stop, text: text.slice(i, stop), line: lineOf(i) });
      blank(code, i, stop);
      blank(keep, i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (i > 0 && IDENT.test(text[i - 1])) {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      const raw = text.slice(i + 1, Math.min(j, n));
      strings.push({ index: i, end: Math.min(j + 1, n), quote: ch, value: raw.replace(/\\(.)/g, '$1'), parts: [raw], line: lineOf(i) });
      blank(code, i + 1, j);
      i = j + 1;
      last = 'x';
      continue;
    }
    if (ch === '`') {
      const entry = { index: i, end: i, quote: '`', value: '', parts: [], line: lineOf(i) };
      i = readTemplate(i + 1, entry).next;
      continue;
    }
    if (templates.length > 0) {
      const top = templates[templates.length - 1];
      if (ch === '{') top.depth += 1;
      if (ch === '}') {
        if (top.depth === 0) {
          templates.pop();
          i = readTemplate(i + 1, top.entry).next;
          continue;
        }
        top.depth -= 1;
      }
    }
    // JSX: "</Tag>" and "{...} />" are tags, never regex literals.
    const isJsxSlash = last === '<' || (last === '}' && next === '>');
    if (ch === '/' && REGEX_AFTER.has(last) && !isJsxSlash) {
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== '\n') {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break;
        j += 1;
      }
      // A regex literal closes on its own line; otherwise this "/" was an operator.
      if (j < n && text[j] === '/') {
        blank(code, i + 1, j);
        i = j + 1;
        last = 'x';
        continue;
      }
    }
    if (!/\s/.test(ch)) {
      if (IDENT.test(ch)) {
        if (i === 0 || !IDENT.test(text[i - 1])) {
          const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i, i + 40));
          if (word && REGEX_KEYWORDS.has(word[0])) {
            i += word[0].length;
            last = '(';
            continue;
          }
        }
        last = 'x';
      } else {
        last = ch === ')' || ch === ']' ? 'x' : ch;
      }
    }
    i += 1;
  }
  const stringAt = new Map(strings.map((entry) => [entry.index, entry]));
  return { code: code.join(''), codeKeep: keep.join(''), comments, strings, stringAt, lineOf };
}

/** Index of the bracket that closes the one at `open` in blanked code, or -1. */
export function matchBracket(code, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const want = pairs[code[open]];
  if (!want) return -1;
  const stack = [want];
  for (let j = open + 1; j < code.length; j += 1) {
    const c = code[j];
    if (c === '(' || c === '[' || c === '{') stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return j;
    }
  }
  return -1;
}

/**
 * Import specifiers of a scanned file:
 *   [{ spec, index, line, form: 'import' | 'export' | 'side-effect' | 'dynamic' | 'require', typeOnly }]
 */
export function importsOf(scan) {
  const { code, stringAt, lineOf } = scan;
  const found = [];
  const add = (quoteIndex, form, typeOnly, at) => {
    const entry = stringAt.get(quoteIndex);
    if (entry && entry.quote !== '`') found.push({ spec: entry.value, index: quoteIndex, line: lineOf(at), form, typeOnly });
  };
  const statement = /(^|[;\n}])(\s*)(import|export)(\s+type)?\b([^;'"`]*?)\bfrom\s*(['"])/g;
  for (const match of code.matchAll(statement)) {
    const at = match.index + match[1].length + match[2].length;
    const quoteIndex = match.index + match[0].length - 1;
    add(quoteIndex, match[3], Boolean(match[4]), at);
  }
  for (const match of code.matchAll(/(^|[;\n])(\s*)import\s*(['"])/g)) {
    add(match.index + match[0].length - 1, 'side-effect', false, match.index + match[1].length + match[2].length);
  }
  for (const match of code.matchAll(/(?<![\w$.])(import|require)\s*\(\s*(['"])/g)) {
    add(match.index + match[0].length - 1, match[1] === 'import' ? 'dynamic' : 'require', false, match.index);
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Count lines that hold code (not blank, not only comments) between two indexes of codeKeep. */
export function codeLineCount(codeKeep, from = 0, to = codeKeep.length) {
  let count = 0;
  for (const line of codeKeep.slice(from, to).split('\n')) if (line.trim() !== '') count += 1;
  return count;
}

/**
 * Functions with a parenthesised parameter list: `function name(...)` and arrow functions
 * `(...) =>` / `(...): Type =>`. Methods are not listed. Returns
 * [{ name, kind, index, line, params, bodyStart, bodyEnd }]; the body range is -1 when there is
 * no block body (an expression-bodied arrow or an overload signature).
 */
export function functionsOf(scan) {
  const { code, lineOf } = scan;
  const skipSpace = (j) => {
    let k = j;
    while (k < code.length && /\s/.test(code[k])) k += 1;
    return k;
  };
  // What follows a parameter list: { arrow: true, at } for "=>", { arrow: false, at } for a body
  // brace, or null when the parentheses are not a parameter list.
  // `isDeclaration`: after `function name(...)` an arrow can only belong to a function type in
  // the return annotation, so the scan continues to the body brace.
  const afterParams = (close, isDeclaration) => {
    const j = skipSpace(close + 1);
    if (code[j] === '=' && code[j + 1] === '>') return isDeclaration ? null : { arrow: true, at: j + 2 };
    if (code[j] === '{') return { arrow: false, at: j };
    if (code[j] !== ':') return null;
    let k = skipSpace(j + 1);
    if (code[k] === '{') {
      const end = matchBracket(code, k);
      if (end === -1) return null;
      k = end + 1;
    }
    let depth = 0;
    for (; k < code.length; k += 1) {
      const c = code[k];
      if (c === '(' || c === '[' || c === '<') depth += 1;
      else if (c === ')' || c === ']' || (c === '>' && code[k - 1] !== '=')) depth -= 1;
      if (depth < 0) return null;
      if (depth > 0) continue;
      if (c === '=' && code[k + 1] === '>') {
        if (!isDeclaration) return { arrow: true, at: k + 2 };
        k += 1;
        continue;
      }
      if (c === '{') return { arrow: false, at: k };
      if (c === ';' || c === ',' || c === '}' || c === '?') return null;
    }
    return null;
  };
  const bodyAt = (at) => {
    const j = skipSpace(at);
    if (code[j] !== '{') return { bodyStart: -1, bodyEnd: -1 };
    return { bodyStart: j, bodyEnd: matchBracket(code, j) };
  };
  // Regions that hold types, not values: a function type there is not a function.
  const typeRegions = typeRegionsOf(code);
  const inType = (index) => typeRegions.some(([from, to]) => index > from && index < to);
  const candidates = [];
  for (let open = code.indexOf('('); open !== -1; open = code.indexOf('(', open + 1)) {
    const close = matchBracket(code, open);
    if (close === -1) continue;
    const before = code.slice(Math.max(0, open - 120), open);
    const declared = /\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(<[^()]*>)?\s*$/.exec(before);
    const follow = afterParams(close, Boolean(declared));
    if (!declared && !follow?.arrow) continue;
    let name = declared?.[1] ?? '';
    if (!name) {
      const assigned = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^;]*)?=\s*(?:async\s*)?(?:<[^()]*>\s*)?$/.exec(before);
      name = assigned?.[1] ?? '(anonymous)';
    }
    const body = follow ? bodyAt(follow.at) : { bodyStart: -1, bodyEnd: -1 };
    // The parameter list and the return type annotation hold types too.
    typeRegions.push([open, close]);
    if (follow) typeRegions.push([close, follow.arrow ? follow.at - 2 : follow.at]);
    candidates.push({ name, kind: declared ? 'function' : 'arrow', index: open, line: lineOf(open), params: countParams(code.slice(open + 1, close)), ...body });
  }
  return candidates.filter((fn) => !inType(fn.index));
}

const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'typeof', 'await', 'function', 'super', 'import', 'require']);

/**
 * Every parameter list ESLint's max-params sees: function declarations and expressions, arrow
 * functions, function TYPES (`(a: A, b: B) => R`) and method shorthand (`name(a, b) {`).
 * Returns [{ name, index, line, params }].
 */
export function paramListsOf(scan) {
  const { code, lineOf } = scan;
  const skipSpace = (j) => {
    let k = j;
    while (k < code.length && /\s/.test(code[k])) k += 1;
    return k;
  };
  const out = [];
  for (let open = code.indexOf('('); open !== -1; open = code.indexOf('(', open + 1)) {
    const close = matchBracket(code, open);
    if (close === -1) continue;
    const before = code.slice(Math.max(0, open - 120), open);
    const declared = /\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(<[^()]*>)?\s*$/.exec(before);
    const j = skipSpace(close + 1);
    const isArrow = code[j] === '=' && code[j + 1] === '>';
    const method = /(?:^|[{,;\s])((?:(?:async|static|get|set|public|private|protected|readonly|override)\s+)*)([A-Za-z_$][\w$]*)\s*(<[^()]*>)?\s*$/.exec(before);
    let isMethod = false;
    if (!declared && !isArrow && method && !NOT_METHODS.has(method[2]) && !/[.\w$]\s*$/.test(before.slice(0, before.length - method[0].length + 1).slice(-1))) {
      let k = j;
      if (code[k] === ':') {
        k = skipSpace(k + 1);
        let depth = 0;
        for (; k < code.length; k += 1) {
          const c = code[k];
          if (c === '(' || c === '[' || c === '<') depth += 1;
          else if (c === ')' || c === ']' || (c === '>' && code[k - 1] !== '=')) depth -= 1;
          if (depth < 0 || (depth === 0 && (c === ';' || c === ',' || c === '}' || c === '?' || c === '='))) break;
          if (depth === 0 && c === '{') break;
        }
      }
      isMethod = code[k] === '{';
    }
    let hasArrowAfterType = false;
    if (!declared && !isArrow && !isMethod && code[j] === ':') {
      // `(a: A): R => ...` arrow with a return type.
      let depth = 0;
      for (let k = skipSpace(j + 1); k < code.length; k += 1) {
        const c = code[k];
        if (c === '(' || c === '[' || c === '<' || c === '{') depth += 1;
        else if (c === ')' || c === ']' || c === '}' || (c === '>' && code[k - 1] !== '=')) depth -= 1;
        if (depth < 0) break;
        if (depth === 0 && c === '=' && code[k + 1] === '>') {
          hasArrowAfterType = true;
          break;
        }
        if (depth === 0 && (c === ';' || c === ',' || c === '?' || (c === '=' && code[k + 1] !== '>'))) break;
      }
    }
    if (!declared && !isArrow && !isMethod && !hasArrowAfterType) continue;
    const name = declared?.[1] ?? (isMethod ? method[2] : '(anonymous)');
    out.push({ name, index: open, line: lineOf(open), params: countParams(code.slice(open + 1, close)) });
  }
  return out;
}

/** [from, to] ranges of `type X = ...;` statements and `const x: Type =` annotations. */
export function typeRegionsOf(code) {
  const regions = [];
  const untilDepthZero = (from, stops) => {
    let depth = 0;
    for (let k = from; k < code.length; k += 1) {
      const c = code[k];
      if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
      else if (c === ')' || c === ']' || c === '}' || (c === '>' && code[k - 1] !== '=')) depth -= 1;
      if (depth < 0) return k;
      if (depth === 0 && stops.includes(c) && !(c === '=' && (code[k + 1] === '>' || code[k + 1] === '='))) return k;
    }
    return code.length;
  };
  for (const match of code.matchAll(/(?<![\w$.])type\s+[A-Za-z_$][\w$]*\s*(?:<[^=;{}]*>)?\s*=/g)) {
    const from = match.index + match[0].length;
    regions.push([match.index, untilDepthZero(from, [';'])]);
  }
  for (const match of code.matchAll(/(?<![\w$.])(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:/g)) {
    const from = match.index + match[0].length;
    regions.push([match.index, untilDepthZero(from, ['=', ';'])]);
  }
  return regions;
}

/** Number of top-level parameters in a parameter list (without the parentheses). */
export function countParams(list) {
  if (list.trim() === '') return 0;
  let depth = 0;
  let count = 1;
  for (let k = 0; k < list.length; k += 1) {
    const c = list[k];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '}' || (c === '>' && list[k - 1] !== '=')) depth -= 1;
    else if (c === ',' && depth === 0) count += 1;
  }
  // A trailing comma (Prettier adds one to wrapped lists) is not a parameter.
  if (/,\s*$/.test(list)) count -= 1;
  const first = list.trim();
  // `this: Type` is a type annotation for `this`, not a parameter.
  if (/^this\s*:/.test(first)) count -= 1;
  return count;
}

// ---------------------------------------------------------------------------------------------
// JSX and call helpers (maskCode output: comments and literal contents blanked)
// ---------------------------------------------------------------------------------------------


/** Blank comments and literal contents; keep delimiters, newlines and positions. */
export function maskCode(source) {
  const out = source.split('');
  const n = source.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  // Template literals can nest `${ ... }` expressions that contain more code.
  const templateStack = [];
  let braceDepth = 0;
  let lastSignificant = '';
  // '<' is left out: "</View>" is a closing tag, not a regex. "/>" is always a self-closing tag.
  const regexAllowedAfter = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '>', '~', '^', 'kw']);
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && source[j] !== ch && source[j] !== '\n') {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSignificant = 'x';
      continue;
    }
    if (ch === '`' || (ch === '}' && templateStack.length > 0 && templateStack.at(-1) === braceDepth)) {
      // Start of a template, or the end of a ${ } expression that resumes the template.
      if (ch === '}') templateStack.pop();
      let j = i + 1;
      let resumed = false;
      while (j < n) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === '`') break;
        if (source[j] === '$' && source[j + 1] === '{') {
          blank(i + 1, j);
          templateStack.push(braceDepth);
          i = j + 2;
          resumed = true;
          break;
        }
        j += 1;
      }
      if (resumed) {
        lastSignificant = '{';
        continue;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSignificant = 'x';
      continue;
    }
    if (ch === '/' && next !== '>' && regexAllowedAfter.has(lastSignificant)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j += 1;
      }
      if (j < n && source[j] === '/') {
        blank(i + 1, j);
        i = j + 1;
        lastSignificant = 'x';
        continue;
      }
    }
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
    if (!/\s/.test(ch)) {
      if (/[A-Za-z_$]/.test(ch) && (i === 0 || !/[A-Za-z0-9_$]/.test(source[i - 1]))) {
        const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i))[0];
        lastSignificant = ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await'].includes(word) ? 'kw' : 'x';
        i += word.length;
        continue;
      }
      lastSignificant = /[A-Za-z0-9_$)\]]/.test(ch) ? 'x' : ch;
    }
    i += 1;
  }
  return out.join('');
}

/** Index of the bracket closing the one at `index` in masked source, or -1. */
export function findClosing(masked, index) {
  const open = masked[index];
  const close = OPENERS[open];
  if (!close) return -1;
  let depth = 0;
  for (let i = index; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * JSX opening and self-closing tags (capitalised component names) in a .tsx file. A "<" glued to
 * an identifier, ")" or "]" is a generic (useState<T>(), Array<T>) and is skipped.
 */
export function findJsxTags(source, masked = maskCode(source)) {
  const tags = [];
  const re = /<([A-Z][A-Za-z0-9_.]*)/g;
  for (const match of masked.matchAll(re)) {
    const start = match.index;
    const before = start > 0 ? masked[start - 1] : '';
    if (/[A-Za-z0-9_$)\].]/.test(before)) continue;
    let i = start + match[0].length;
    let depth = 0;
    let end = -1;
    let selfClosing = false;
    while (i < masked.length) {
      const ch = masked[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (depth === 0 && ch === '>') {
        end = i;
        selfClosing = masked[i - 1] === '/';
        break;
      } else if (depth === 0 && ch === '<') break;
      i += 1;
    }
    if (end === -1) continue;
    const attrsFrom = start + match[0].length;
    tags.push({ name: match[1], start, end, attrsFrom, attrsTo: selfClosing ? end - 1 : end, selfClosing });
  }
  return tags;
}

/** Attributes of one tag from findJsxTags. Values keep their original (unmasked) text. */
export function jsxAttributes(source, tag, masked = maskCode(source)) {
  const attrs = new Map();
  let i = tag.attrsFrom;
  const to = tag.attrsTo;
  while (i < to) {
    while (i < to && /\s/.test(masked[i])) i += 1;
    if (i >= to) break;
    if (masked[i] === '{') {
      // Spread attribute {...props}: skip it.
      const close = findClosing(masked, i);
      if (close === -1) break;
      attrs.set(`...${i}`, { kind: 'spread', value: source.slice(i + 1, close), index: i });
      i = close + 1;
      continue;
    }
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_:-]*/.exec(masked.slice(i, to));
    if (!nameMatch) {
      i += 1;
      continue;
    }
    const name = nameMatch[0];
    const index = i;
    i += name.length;
    while (i < to && /\s/.test(masked[i])) i += 1;
    if (masked[i] !== '=') {
      attrs.set(name, { kind: 'bool', value: 'true', index });
      continue;
    }
    i += 1;
    while (i < to && /\s/.test(masked[i])) i += 1;
    const quote = masked[i];
    if (quote === '"' || quote === "'") {
      const close = masked.indexOf(quote, i + 1);
      attrs.set(name, { kind: 'string', value: source.slice(i + 1, close), index });
      i = close + 1;
    } else if (quote === '{') {
      const close = findClosing(masked, i);
      attrs.set(name, { kind: 'expr', value: source.slice(i + 1, close).trim(), index });
      i = close + 1;
    } else {
      i += 1;
    }
  }
  return attrs;
}

/** String value of an attribute expression when it is a plain literal: "x", 'x', `x` (no ${}). */
export function literalOf(attr) {
  if (!attr) return null;
  if (attr.kind === 'string') return attr.value;
  if (attr.kind !== 'expr') return null;
  const m = /^(['"`])([\s\S]*)\1$/.exec(attr.value);
  if (!m) return null;
  if (m[1] === '`' && m[2].includes('${')) return null;
  return m[2];
}

/** Calls whose callee matches `callee` (a RegExp source without the "("), e.g. 'StyleSheet\\.create'. */
export function findCalls(masked, callee) {
  const calls = [];
  const re = new RegExp(`(?<![A-Za-z0-9_$.])${callee}\\s*\\(`, 'g');
  for (const match of masked.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open);
    if (close !== -1) calls.push({ start: match.index, open, close });
  }
  return calls;
}

/** The first-level import specifiers of a module: [{ from, index, text }]. */
export function findImports(source, masked = maskCode(source)) {
  const imports = [];
  const re = /(^|\n)\s*import\s[^;]*?from\s*(['"])([^'"]*)\2|(^|\n)\s*import\s*(['"])([^'"]*)\5/g;
  // Match on the original text: module specifiers are blanked in the masked copy.
  for (const match of source.matchAll(re)) {
    const index = match.index + match[0].search(/import/);
    if (masked.slice(index, index + 6) !== 'import') continue; // inside a comment or a string
    const from = match[3] ?? match[6];
    imports.push({ from, index, text: match[0].trim() });
  }
  return imports;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** A file-level 'worklet' directive: the first statement after any leading comments. */
const DIRECTIVE = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]worklet['"];/;
/** import/export ... from '...' that is not `import type` / `export type`. */
const VALUE_IMPORT = /^[ \t]*(import|export)\s+(?!type\b)([^'";]*?)\bfrom\s+['"]([^'"]+)['"]/gm;

export function hasWorkletDirective(source) {
  return DIRECTIVE.test(source);
}

/**
 * Value imports of a file: [{ spec, index }]. `import { type A, type B } from` counts as type-only;
 * a side-effect import (`import 'x'`) is ignored.
 */
export function valueImports(source) {
  const out = [];
  for (const match of source.matchAll(VALUE_IMPORT)) {
    const clause = match[2];
    const braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, '').replace(/[\s,]/g, '');
    const names = braces ? braces[1].split(',').map((name) => name.trim()).filter(Boolean) : [];
    const isTypeOnly = outside === '' && names.length > 0 && names.every((name) => name.startsWith('type '));
    if (!isTypeOnly) out.push({ spec: match[3], index: match.index });
  }
  return out;
}

/** Reads a repo-relative file, or null when it does not exist. */
export function readRepoFile(root, rel) {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** Text between the parenthesis at `openIndex` and its partner (strings and templates skipped), or null. */
export function balancedParens(source, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** The opening JSX tag that starts at `index` (up to the first unquoted '>' outside braces). */
export function openingTag(source, index) {
  let depth = 0;
  let quote = null;
  for (let i = index; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(index, i + 1);
  }
  return source.slice(index);
}

/**
 * True for colocated tests and test-only folders, which may simulate what runtime code must not do:
 * *.test.ts(x), *.spec.ts(x), anything under __tests__/ or __mocks__/, and the repo's test/ folder.
 */
export function isTestFile(rel) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.startsWith('test/') || rel.includes('/__mocks__/') || rel.startsWith('__mocks__/') || rel.includes('/__tests__/') || rel.startsWith('__tests__/');
}

// ---------------------------------------------------------------------------------------------
// Import resolution: relative paths and tsconfig "paths" aliases, probed the way Metro and
// TypeScript look files up
// ---------------------------------------------------------------------------------------------

export const RESOLVE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);
export const RESOLVE_PLATFORMS = Object.freeze(['ios', 'android', 'native', 'web']);

const aliasCache = new Map();

/** The tsconfig.json aliases of a repo root, cached until the file changes. */
function aliasesOf(root) {
  const file = join(root, 'tsconfig.json');
  const stamp = existsSync(file) ? statSync(file).mtimeMs : -1;
  const cached = aliasCache.get(root);
  if (cached && cached.stamp === stamp) return cached.aliases;
  const aliases = readTsconfigPaths(root)?.aliases ?? [];
  aliasCache.set(root, { stamp, aliases });
  return aliases;
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();

const workspaceCache = new Map();

/** The workspace packages of a repo root ([{ name, dir, main }], longest name first), cached until package.json changes. */
function workspacesOf(root) {
  const file = join(root, 'package.json');
  const stamp = existsSync(file) ? statSync(file).mtimeMs : -1;
  const cached = workspaceCache.get(root);
  if (cached && cached.stamp === stamp) return cached.packages;
  const packages = readWorkspaces(root)
    .filter((entry) => entry.name)
    .map((entry) => ({ name: entry.name, dir: entry.dir, main: typeof entry.manifest?.main === 'string' ? entry.manifest.main.replace(/^\.\//, '') : null }))
    .sort((a, b) => b.name.length - a.name.length);
  workspaceCache.set(root, { stamp, packages });
  return packages;
}

/** Candidate paths for a workspace package import (@acme/core, @acme/core/money), or null. */
function workspaceBases(root, spec) {
  for (const pkg of workspacesOf(root)) {
    if (spec !== pkg.name && !spec.startsWith(`${pkg.name}/`)) continue;
    const sub = spec.slice(pkg.name.length + 1);
    if (sub === '') return [pkg.main ? posix.join(pkg.dir, pkg.main) : null, posix.join(pkg.dir, 'src', 'index'), posix.join(pkg.dir, 'index')].filter(Boolean);
    return [posix.join(pkg.dir, sub), posix.join(pkg.dir, 'src', sub)];
  }
  return null;
}

/** Files to try for a path, in order: as written, + extension (and .<platform> variants), then index files. */
function candidatesFor(base, extensions, platforms) {
  const out = [base];
  // TypeScript lets './x.js' name './x.ts' (ESM-style specifiers).
  const swapped = /\.(m|c)?jsx?$/.exec(base);
  if (swapped) {
    const stem = base.slice(0, -swapped[0].length);
    const tsExt = swapped[0].replace('js', 'ts');
    out.push(`${stem}${tsExt}`);
    if (!tsExt.endsWith('x')) out.push(`${stem}${tsExt}x`);
  }
  for (const ext of extensions) {
    out.push(`${base}${ext}`);
    for (const platform of platforms) out.push(`${base}.${platform}${ext}`);
  }
  for (const ext of extensions) {
    out.push(`${base}/index${ext}`);
    for (const platform of platforms) out.push(`${base}/index.${platform}${ext}`);
  }
  return out;
}

/**
 * Resolve one import specifier written in the repo file `fromRel`:
 *   { kind: 'external', spec, path: null, exists: false }   a package (react-native, @scope/pkg)
 *   { kind: 'local', spec, path, exists }                    a relative path or a tsconfig alias
 * options.aliases: tsconfig aliases ([{ pattern, targets }], as resolveLayout(root).aliases gives);
 *   default: read from <root>/tsconfig.json (with "extends") when root is given. With root, the names of
 *   the repo's workspace packages (package.json "workspaces") are local too: @acme/core/money probes
 *   packages/core/money, then packages/core/src/money.
 * options.root: probe on disk: the path as written, then + each extension (and its .ios / .android /
 *   .native / .web variants), then <path>/index.<ext>; `path` is the first file that exists and
 *   `exists` is true. Nothing found: `path` is the unprobed path and `exists` is false. Without root
 *   nothing is probed and `exists` is null.
 *   resolveImport('src/features/tasks/tasks-screen.tsx', '@/ui/app-text', { root })
 *     -> { kind: 'local', spec: '@/ui/app-text', path: 'src/ui/app-text.tsx', exists: true }
 */
export function resolveImport(fromRel, spec, { root = null, aliases, extensions = RESOLVE_EXTENSIONS, platforms = RESOLVE_PLATFORMS } = {}) {
  let bases = null;
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    bases = [posix.normalize(posix.join(posix.dirname(fromRel.split('\\').join('/')), spec))];
  } else if (!spec.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(spec)) {
    const mapped = resolveAlias(spec, aliases ?? (root === null ? [] : aliasesOf(root)));
    if (mapped !== null) bases = mapped.map((path) => posix.normalize(path));
    // A monorepo's own packages (package.json "workspaces"): @acme/core/money -> packages/core/money or packages/core/src/money.
    else if (root !== null) bases = workspaceBases(root, spec);
  }
  if (bases === null || bases.length === 0) return { kind: 'external', spec, path: null, exists: false };
  if (root === null) return { kind: 'local', spec, path: bases[0], exists: null };
  for (const base of bases) {
    for (const candidate of candidatesFor(base, extensions, platforms)) {
      if (isFile(join(root, candidate))) return { kind: 'local', spec, path: candidate, exists: true };
    }
  }
  return { kind: 'local', spec, path: bases[0], exists: false };
}

/**
 * The repo-relative file an import points at, or null for a package (see resolveImport).
 *   resolveSpecifier('src/a/b.ts', '../ui/x')                       -> 'src/ui/x' (no root: not probed)
 *   resolveSpecifier('src/a/b.ts', '@/ui/app-text', { root })      -> 'src/ui/app-text.tsx'
 * Changed from the older per-skill copy: aliases come from tsconfig "paths" and workspace package names
 * come from package.json (both need options.root), not a fixed package scope.
 */
export function resolveSpecifier(fromRel, spec, options = {}) {
  const resolved = resolveImport(fromRel, spec, options);
  return resolved.kind === 'external' ? null : resolved.path;
}
