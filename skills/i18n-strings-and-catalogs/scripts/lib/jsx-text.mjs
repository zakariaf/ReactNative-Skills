// jsx-text.mjs: finds the text a JSX element renders, for check-i18n-code.mjs. Not an entry point.
//
//   jsxChildren(source, masked, tag) -> { closed, runs: [{ index, text }], expressions: [{ index, value }] }
//       every text run and every {expression} child between the tag and its matching closing tag,
//       at any depth (nested capitalised tags are reported again by their own walk: dedupe by index).
//       `closed` is false when the closing tag was never found (a generic arrow such as <T,>(x) => x,
//       or source the masker could not follow): the caller then ignores the result.
//   textLiteral(expression) -> the text of a whole-expression string literal ('x', "x", `x` without
//       ${}), or null
//   builtText(expression) -> true for a template literal with ${} and letters outside it
//   literalBranch(expression) -> the quoted text an expression can evaluate to (`isOn ? 'On' : t(...)`,
//       `name ?? 'Guest'`, `error && 'Failed'`), or null. Only depth-0 operands count: object and
//       array literals, calls and JSX elements inside the expression are blanked first.
//   quotedTextProperties(text, names) -> [{ index, name, value }] for `name: 'literal with letters'`
//   quotedTextsInArray(text, names) -> [{ index, name, value }] for each literal with letters at
//       depth 0 of `name: ['Cancel', 'Delete']` (`[t('common.cancel'), ...labels]` has none)
//   decodeEscapes(text) -> a string literal's body with its JS escapes decoded ('\n' -> newline), so
//       an escaped newline or tab ({'\n'}) is whitespace, not the letter n

import { findClosing } from './source-scan.mjs';

const LETTER = /\p{L}/u;
const SIMPLE_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

/** A string literal body with its escapes decoded: \n \t \xHH \uHHHH \u{H…}, a line continuation, \<char>. */
export function decodeEscapes(text) {
  return text.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, escape) => {
    if (/^[ux]/.test(escape) && escape.length > 1) return String.fromCodePoint(Number.parseInt(escape.replace(/^u\{?|^x|\}$/g, ''), 16));
    if (escape === '\n' || escape === '\r\n' || escape === '\r' || escape === '\u2028' || escape === '\u2029') return '';
    return SIMPLE_ESCAPES[escape] ?? escape;
  });
}

/** True when the decoded literal body holds a letter (an escaped \n is not the letter n). */
function hasLetter(body) {
  return LETTER.test(decodeEscapes(body));
}

/** The end of the opening or self-closing tag that starts at `from` ('<'), or null. */
function tagEnd(masked, from) {
  let depth = 0;
  for (let i = from + 1; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 0 && ch === '>') return { end: i, selfClosing: masked[i - 1] === '/' };
    else if (depth === 0 && ch === '<') return null;
  }
  return null;
}

/**
 * Text runs and expression children of a non-self-closing tag from findJsxTags. Each entry names the
 * innermost element that renders it (`owner`; '' for a fragment).
 */
export function jsxChildren(source, masked, tag) {
  const runs = [];
  const expressions = [];
  const result = (closed) => ({ closed, runs, expressions });
  const owners = [tag.name];
  let i = tag.end + 1;
  let runStart = i;
  const flush = (to) => {
    const text = masked.slice(runStart, to);
    const at = text.search(LETTER);
    if (at !== -1) runs.push({ index: runStart + at, text: source.slice(runStart, to).trim(), owner: owners.at(-1) });
  };
  while (i < masked.length) {
    const ch = masked[i];
    if (ch !== '{' && ch !== '<') {
      i += 1;
      continue;
    }
    flush(i);
    if (ch === '{') {
      const close = findClosing(masked, i);
      if (close === -1) return result(false);
      expressions.push({ index: i + 1, value: source.slice(i + 1, close).trim(), owner: owners.at(-1) });
      i = close + 1;
    } else if (masked[i + 1] === '/') {
      const end = masked.indexOf('>', i);
      if (end === -1) return result(false);
      owners.pop();
      i = end + 1;
      if (owners.length === 0) return result(true);
    } else {
      const found = tagEnd(masked, i);
      if (!found) return result(false);
      if (!found.selfClosing) owners.push(/^<([A-Za-z][\w.:-]*)?/.exec(masked.slice(i, i + 80))?.[1] ?? '');
      i = found.end + 1;
    }
    runStart = i;
  }
  return result(false);
}

/** The text of an expression that is one string literal with letters, or null. */
export function textLiteral(expression) {
  const match = /^(['"`])((?:(?!\1)[^\\]|\\.)*)\1$/su.exec(expression.trim());
  if (!match || (match[1] === '`' && match[2].includes('${'))) return null;
  return hasLetter(match[2]) ? match[2] : null;
}

/** A template literal that glues words around ${} values: `Page ${page}`. */
export function builtText(expression) {
  const text = expression.trim();
  return /^`[\s\S]*\$\{[\s\S]*`$/.test(text) && hasLetter(text.replace(/\$\{[^}]*\}/g, ''));
}

/** The index after the string literal that starts at `from` (a template's ${} groups skipped whole). */
function stringEnd(text, from) {
  const quote = text[from];
  for (let i = from + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (quote === '`' && text[i] === '$' && text[i + 1] === '{') i = groupEnd(text, i + 1) - 1;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/** The index after the bracket group that opens at `from` ( ( [ { ), strings inside skipped. */
function groupEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') i = stringEnd(text, i) - 1;
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/**
 * The index after the JSX element that starts at `from` ('<'): tags are counted, attribute strings
 * and {…} groups skipped (an arrow's => is not a tag end), body text is text (an apostrophe in
 * <Text>Don't</Text> opens no string).
 */
function jsxElementEnd(text, from) {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    if (text[i] === '{') {
      i = groupEnd(text, i);
      continue;
    }
    if (text[i] !== '<') {
      i += 1;
      continue;
    }
    const closing = text[i + 1] === '/';
    let j = i + 1;
    while (j < text.length && text[j] !== '>') {
      if (text[j] === '"' || text[j] === "'") j = stringEnd(text, j);
      else if (text[j] === '{') j = groupEnd(text, j);
      else j += 1;
    }
    if (closing) depth -= 1;
    else if (text[j - 1] !== '/') depth += 1;
    i = j + 1;
    if (depth <= 0) return Math.min(i, text.length);
  }
  return text.length;
}

/** True when what came before (blanked text) leaves an operand position: start, ( ? : && || ?? , =>. */
function atOperand(before) {
  const tail = before.trimEnd();
  return tail === '' || /(?:[?:(,[{]|&&|\|\||=>)$/.test(tail);
}

/**
 * The expression with everything below depth 0 blanked: comments, every () [] {} group with its
 * strings (an object or array literal, a call's arguments, a typed href object), and every JSX
 * element with its attributes and body. What stays is the expression's own operators and operands.
 */
function depthZero(expression) {
  let out = '';
  let i = 0;
  const blank = (to) => {
    out += expression.slice(i, to).replace(/[^\n]/g, ' ');
    i = to;
  };
  while (i < expression.length) {
    const ch = expression[i];
    const next = expression[i + 1] ?? '';
    if (ch === '/' && next === '/') blank(expression.includes('\n', i) ? expression.indexOf('\n', i) : expression.length);
    else if (ch === '/' && next === '*') blank(expression.includes('*/', i + 2) ? expression.indexOf('*/', i + 2) + 2 : expression.length);
    else if (ch === '"' || ch === "'" || ch === '`') {
      const end = stringEnd(expression, i);
      out += expression.slice(i, end);
      i = end;
    } else if (ch === '<' && /[A-Za-z>]/.test(next) && atOperand(out)) blank(jsxElementEnd(expression, i));
    else if ('([{'.includes(ch)) blank(groupEnd(expression, i));
    else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * A quoted string with letters the expression can evaluate to (`isOn ? 'On' : 'Off'`,
 * `name ?? 'Guest'`, `error && 'Failed'`): only an operand at depth 0 counts, so the quoted values
 * of an object or array literal, a call or a JSX element in a one-line conditional
 * (`{id === null && <Link href={{ pathname: '/settings' }} />}`) are not rendered text.
 */
export function literalBranch(expression) {
  const match = /(?:^|[?:]|\?\?|\|\||&&)\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/u.exec(depthZero(expression).trim());
  return match && hasLetter(match[2]) && !/\$\{/.test(match[2]) ? match[0].trim() : null;
}

/** `name: 'text'` entries with letters inside an object literal's text (accessibilityValue, buttons). */
export function quotedTextProperties(text, names) {
  const found = [];
  const re = new RegExp(`\\b(${names.join('|')})\\s*:\\s*(['"\`])((?:(?!\\2)[^\\\\]|\\\\.)*)\\2`, 'gu');
  for (const match of text.matchAll(re)) {
    if (hasLetter(match[3]) && !match[3].includes('${')) found.push({ index: match.index, name: match[1], value: match[3] });
  }
  return found;
}

/**
 * Each literal with letters at depth 0 of `name: [ ... ]` (ActionSheetIOS options): the array's own
 * items only, so the key of t('common.cancel'), a call's arguments and a nested object's values are
 * not shown text. depthZero keeps every index, so a finding points at its literal.
 */
export function quotedTextsInArray(text, names) {
  const found = [];
  if (names.length === 0) return found;
  for (const array of text.matchAll(new RegExp(`\\b(${names.join('|')})\\s*:\\s*\\[`, 'g'))) {
    const bodyStart = array.index + array[0].length;
    const body = text.slice(bodyStart, Math.max(bodyStart, groupEnd(text, bodyStart - 1) - 1));
    for (const item of depthZero(body).matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/gu)) {
      if (hasLetter(item[2]) && !item[2].includes('${')) found.push({ index: bodyStart + item.index, name: array[1], value: item[2] });
    }
  }
  return found;
}
