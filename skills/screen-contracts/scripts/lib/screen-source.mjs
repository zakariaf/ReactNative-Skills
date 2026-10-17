// screen-source.mjs: pulls string literals, template-literal patterns, t() keys, JSX uses and test
// blocks out of TypeScript sources without a parser. Helper for check-screens.mjs (not an entry point).

import { lineOf, maskComments } from '../check-lib.mjs';

/** One dynamic segment of a testID or key: `${list.id}` in lists.list-row.${list.id}. */
export const SEGMENT = '[a-z0-9-]+';
/** Marks an interpolation inside a joined template while it is split into segments. */
const HOLE = '\u0000';

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read a template literal starting at `start` (the backtick); returns its parts and end index. */
function readTemplate(source, start) {
  const parts = [''];
  let i = start + 1;
  while (i < source.length && source[i] !== '`') {
    if (source[i] === '\\') {
      parts[parts.length - 1] += source.slice(i, i + 2);
      i += 2;
    } else if (source[i] === '$' && source[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth += 1;
        else if (source[j] === '}') depth -= 1;
        j += 1;
      }
      parts.push(null, '');
      i = j;
    } else {
      parts[parts.length - 1] += source[i];
      i += 1;
    }
  }
  return { parts, end: i + 1 };
}

/**
 * Every string in a file, comments masked first:
 *   plain:    { value, line, index }                       'lists.screen', "lists.screen", `lists.screen`
 *   template: { parts: ['lists.list-row.', null, ''], line, index }   (null = an interpolation)
 */
export function scanStrings(rawSource) {
  const source = maskComments(rawSource);
  const plain = [];
  const templates = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      plain.push({ value: source.slice(i + 1, j), line: lineOf(source, i), index: i });
      i = j + 1;
    } else if (ch === '`') {
      const { parts, end } = readTemplate(source, i);
      if (parts.length === 1) plain.push({ value: parts[0], line: lineOf(source, i), index: i });
      else templates.push({ parts, line: lineOf(source, i), index: i });
      i = end;
    } else {
      i += 1;
    }
  }
  return { plain, templates, source };
}

/** A template that starts with literal text, as a full pattern: lists.list-row.${id} -> /^lists\.list-row\.[a-z0-9-]+$/. */
export function templateRegExp(parts) {
  return new RegExp(`^${parts.map((part) => (part === null ? SEGMENT : escapeRegExp(part))).join('')}$`);
}

/**
 * The canonical form of a template or a contract id: every segment that holds an interpolation (or
 * a `{param}` placeholder) becomes `*`. lists.list-row.${list.id} and lists.list-row.{listId} are
 * both `lists.list-row.*`, so a pattern in code and a placeholder in the contract compare equal.
 */
export function canonicalOfParts(parts) {
  return parts
    .map((part) => (part === null ? HOLE : part))
    .join('')
    .split('.')
    .map((segment) => (segment.includes(HOLE) ? '*' : segment))
    .join('.');
}

/** A canonical id (with `*` segments) as a regular expression over concrete ids. */
export function canonicalRegExp(canon) {
  return new RegExp(`^${canon.split('.').map((segment) => (segment === '*' ? SEGMENT : escapeRegExp(segment))).join('\\.')}$`);
}

/**
 * A template that starts with an interpolation (`${testID}.label`): the literal tail after the
 * first interpolation as a suffix pattern over canonical ids (\.label$); `*` segments match too.
 * Returns null when there is no tail or the tail does not start a new segment.
 */
export function suffixRegExp(parts) {
  const tail = parts.slice(2);
  if (tail.length === 0 || tail.every((part) => part === null || part === '')) return null;
  const body = tail.map((part) => (part === null ? `(?:${SEGMENT}|\\*)` : escapeRegExp(part))).join('');
  if (!body.startsWith('\\.')) return null;
  return new RegExp(`${body}$`);
}

/** String literals passed to t(...): `t('a.b')`, `t(isX ? 'a.b' : 'c.d', { … })`. Comments must be masked. */
export function scanTKeys(source) {
  const keys = [];
  for (const match of source.matchAll(/(^|[^A-Za-z0-9_$.])t\(/g)) {
    let depth = 1;
    let j = match.index + match[0].length;
    const start = j;
    while (j < source.length && depth > 0) {
      if (source[j] === '(') depth += 1;
      else if (source[j] === ')') depth -= 1;
      j += 1;
    }
    const keyPart = source.slice(start, j - 1).split('{')[0];
    for (const literal of keyPart.matchAll(/['"]([a-z0-9]+(?:[.-][a-z0-9]+)+)['"]/g)) {
      keys.push({ key: literal[1], line: lineOf(source, start + literal.index) });
    }
  }
  return keys;
}

/** The opening JSX tag starting at `start` ("<Name ..."), up to its closing ">" outside braces. */
export function openingTag(source, start) {
  let depth = 0;
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Lines where a file renders `<Name` or imports Name by name (comments masked). */
export function componentUses(source, name) {
  const lines = [];
  const escaped = escapeRegExp(name);
  for (const match of source.matchAll(new RegExp(`<${escaped}\\b|import\\s*(?:type\\s+)?\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*from`, 'g'))) {
    lines.push(lineOf(source, match.index));
  }
  return lines;
}

/** True when the file renders `<Name` (comments masked). */
export function rendersComponent(source, name) {
  return new RegExp(`<${escapeRegExp(name)}\\b`).test(source);
}

/**
 * Lines of every JSX element `<component ... prop="value">` (also prop={'value'} and prop={"value"}):
 * the primary actions of a file when `match` is { component: 'Button', prop: 'variant', value: 'primary' }.
 */
export function elementsWithProp(source, { component, prop, value }) {
  const lines = [];
  const attribute = new RegExp(`(?:^|\\s)${escapeRegExp(prop)}=(?:"${escapeRegExp(value)}"|\\{\\s*['"]${escapeRegExp(value)}['"]\\s*\\})`);
  for (const match of source.matchAll(new RegExp(`<${escapeRegExp(component)}\\b`, 'g'))) {
    if (attribute.test(openingTag(source, match.index))) lines.push(lineOf(source, match.index));
  }
  return lines;
}

/** The index of the brace that closes the one opened at `open`. */
function closeOf(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && (depth -= 1) === 0) return i;
  }
  return source.length - 1;
}

const BLOCK_START = /\b(it|test|describe)(?:\.each\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\2).)*)\2\s*,/g;

/**
 * Every it()/test() block of a test file, comments masked first (a commented-out audit does not
 * count): { name, title, line, body }. `title` joins the enclosing describe() titles and the block's own.
 */
export function testBlocks(rawSource) {
  const source = maskComments(rawSource);
  const describes = [];
  const blocks = [];
  for (const match of source.matchAll(BLOCK_START)) {
    const arrow = source.indexOf('=>', match.index);
    const open = arrow === -1 ? -1 : source.indexOf('{', arrow);
    if (open === -1) continue;
    const close = closeOf(source, open);
    if (match[1] === 'describe') describes.push({ name: match[3], start: open, end: close });
    else blocks.push({ name: match[3], index: match.index, line: lineOf(source, match.index), body: source.slice(open, close + 1) });
  }
  return blocks.map((block) => {
    const outer = describes.filter((each) => each.start < block.index && block.index < each.end).map((each) => each.name);
    return { name: block.name, title: [...outer, block.name].join(' '), line: block.line, body: block.body };
  });
}
