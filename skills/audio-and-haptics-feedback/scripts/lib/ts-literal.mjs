// ts-literal.mjs: reads a TypeScript object/array literal (plain data) without a TypeScript compiler.
// Not an entry point. Supports objects, arrays, single/double-quoted strings, numbers (with _ separators
// and a leading minus), true/false/null, comments and trailing commas. Anything else (identifiers,
// spreads, calls, template strings) is reported as "not literal data", with its source index.
// One canonical copy, synced into every skill that declares it.
//
//   findConstInitializer(source, name) -> index | -1      parseValue(source, start) -> { value, end }
//   parseObjectEntries(source, start) -> [{ key, index, value } | { key, index, error, errorIndex }]
//   LiteralError (message, index)
// A trailing `as const` or `satisfies Type` after the literal is simply not read.

export class LiteralError extends Error {
  constructor(message, index) {
    super(message);
    this.index = index;
  }
}

/** Index of the first character of the initializer of `const <name>` (after `=`), or -1. */
export function findConstInitializer(source, name) {
  const re = new RegExp(`\\bconst\\s+${name}\\b[^=;]*=\\s*`, 'm');
  const match = re.exec(source);
  return match ? match.index + match[0].length : -1;
}

function skipSpace(source, start) {
  let i = start;
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end + 1;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      return i;
    }
  }
}

function parseString(source, start) {
  const quote = source[start];
  let i = start + 1;
  let out = '';
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') {
      out += source[i + 1];
      i += 2;
    } else {
      if (source[i] === '\n') throw new LiteralError('unterminated string', start);
      out += source[i];
      i += 1;
    }
  }
  if (i >= source.length) throw new LiteralError('unterminated string', start);
  return { value: out, end: i + 1 };
}

function parseNumber(source, start) {
  const match = /^-?(?:\d[\d_]*)?(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/.exec(source.slice(start));
  const text = match ? match[0] : '';
  if (text === '' || text === '-' || text === '.') throw new LiteralError('expected a number', start);
  return { value: Number(text.replace(/_/g, '')), end: start + text.length };
}

function parseKey(source, start) {
  const ch = source[start];
  if (ch === "'" || ch === '"') return parseString(source, start);
  const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(start)) ?? /^\d+/.exec(source.slice(start));
  if (!match) throw new LiteralError('expected a property name', start);
  return { value: match[0], end: start + match[0].length };
}

function parseObject(source, start) {
  const value = {};
  let i = skipSpace(source, start + 1);
  while (source[i] !== '}') {
    if (source.startsWith('...', i)) throw new LiteralError('spread is not literal data', i);
    const key = parseKey(source, i);
    i = skipSpace(source, key.end);
    if (source[i] !== ':') throw new LiteralError(`expected ":" after "${key.value}" (shorthand properties are not literal data)`, i);
    const item = parseValue(source, skipSpace(source, i + 1));
    value[key.value] = item.value;
    i = skipSpace(source, item.end);
    if (source[i] === ',') i = skipSpace(source, i + 1);
    else if (source[i] !== '}') throw new LiteralError('expected "," or "}"', i);
  }
  return { value, end: i + 1 };
}

function parseArray(source, start) {
  const value = [];
  let i = skipSpace(source, start + 1);
  while (source[i] !== ']') {
    if (source.startsWith('...', i)) throw new LiteralError('spread is not literal data', i);
    const item = parseValue(source, i);
    value.push(item.value);
    i = skipSpace(source, item.end);
    if (source[i] === ',') i = skipSpace(source, i + 1);
    else if (source[i] !== ']') throw new LiteralError('expected "," or "]"', i);
  }
  return { value, end: i + 1 };
}

/** Parses the literal value that starts at `start` (after optional whitespace/comments). */
export function parseValue(source, start) {
  const i = skipSpace(source, start);
  const ch = source[i];
  if (ch === '{') return parseObject(source, i);
  if (ch === '[') return parseArray(source, i);
  if (ch === "'" || ch === '"') return parseString(source, i);
  if (ch === '-' || ch === '.' || /\d/.test(ch ?? '')) return parseNumber(source, i);
  const word = /^[A-Za-z_$][\w$.]*/.exec(source.slice(i))?.[0];
  if (word === 'true' || word === 'false') return { value: word === 'true', end: i + word.length };
  if (word === 'null') return { value: null, end: i + 4 };
  if (ch === '`') throw new LiteralError('template strings are not literal data', i);
  throw new LiteralError(word ? `"${word}" is not literal data (inline the value)` : 'expected a literal value', i);
}

/**
 * The entries of an object literal as [key, value, index] triples, parsed one by one so a bad entry
 * does not hide the others. Each value is { value } or { error, index }.
 */
export function parseObjectEntries(source, start) {
  const entries = [];
  let i = skipSpace(source, start);
  if (source[i] !== '{') throw new LiteralError('expected an object literal', i);
  i = skipSpace(source, i + 1);
  while (i < source.length && source[i] !== '}') {
    const keyAt = i;
    const key = parseKey(source, i);
    i = skipSpace(source, key.end);
    if (source[i] !== ':') throw new LiteralError(`expected ":" after "${key.value}"`, i);
    const valueAt = skipSpace(source, i + 1);
    try {
      const item = parseValue(source, valueAt);
      entries.push({ key: key.value, index: keyAt, value: item.value });
      i = skipSpace(source, item.end);
    } catch (error) {
      if (!(error instanceof LiteralError)) throw error;
      entries.push({ key: key.value, index: keyAt, error: error.message, errorIndex: error.index });
      i = skipToNextEntry(source, valueAt);
    }
    if (source[i] === ',') i = skipSpace(source, i + 1);
  }
  return entries;
}

/** After a bad value: skip to the "," or "}" that ends this entry at depth 0. */
function skipToNextEntry(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (ch === ',' && depth === 0) return i;
  }
  return source.length;
}
