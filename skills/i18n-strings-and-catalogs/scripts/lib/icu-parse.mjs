// icu-parse.mjs: a small ICU MessageFormat parser with the same element shapes as
// @formatjs/icu-messageformat-parser (the parser react-intl uses), so the checks here agree with
// what the app does at runtime. Not an entry point.
//
// parseIcu(message, { requiresOtherClause = true }) -> elements[]; throws IcuSyntaxError.
// Elements:
//   { type: 'literal', value }
//   { type: 'argument', value: name }                       plain {name}
//   { type: 'number' | 'date' | 'time', value: name, style } {name, number[, style]}
//   { type: 'plural', value: name, pluralType: 'cardinal' | 'ordinal', offset, options: { sel: { value: elements[] } } }
//   { type: 'select', value: name, options: { sel: { value: elements[] } } }
//   { type: 'pound' }                                        # inside a plural
//   { type: 'tag', value: tagName, children: elements[] }    <b>...</b>
//
// Quoting follows ICU/FormatJS: '' is one apostrophe; an apostrophe followed by { } < > (or # inside
// a plural) starts quoted literal text that ends at the next lone apostrophe.

export class IcuSyntaxError extends Error {
  constructor(message, offset) {
    super(`${message} (at character ${offset})`);
    this.name = 'IcuSyntaxError';
    this.offset = offset;
  }
}

const ARG_TYPES = new Set(['number', 'date', 'time', 'plural', 'selectordinal', 'select']);

export function parseIcu(message, { requiresOtherClause = true } = {}) {
  let pos = 0;
  const text = String(message);

  const error = (what) => {
    throw new IcuSyntaxError(what, pos);
  };
  const peek = () => text[pos];
  const skipSpace = () => {
    while (pos < text.length && /\s/.test(text[pos])) pos += 1;
  };
  const readIdentifier = () => {
    const match = /^[^\s{}#<>,'=]+/u.exec(text.slice(pos));
    if (!match) return '';
    pos += match[0].length;
    return match[0];
  };

  // Reads elements until the matching close ("}" of a plural/select option, or "</tag>"), or the end.
  function parseMessage(depth, parentArg, closingTag) {
    const elements = [];
    let literal = '';
    const flush = () => {
      if (literal !== '') {
        const last = elements.at(-1);
        if (last && last.type === 'literal') last.value += literal;
        else elements.push({ type: 'literal', value: literal });
        literal = '';
      }
    };
    while (pos < text.length) {
      const ch = peek();
      if (ch === '{') {
        flush();
        elements.push(parseArgument(depth));
        continue;
      }
      if (ch === '}') {
        if (depth > 0) break;
        error('unmatched "}"');
      }
      if (ch === '#' && (parentArg === 'plural' || parentArg === 'selectordinal')) {
        flush();
        pos += 1;
        elements.push({ type: 'pound' });
        continue;
      }
      if (ch === '<' && /[A-Za-z]/.test(text[pos + 1] ?? '')) {
        flush();
        elements.push(parseTag(depth, parentArg));
        continue;
      }
      if (ch === '<' && text[pos + 1] === '/') {
        if (closingTag) break;
        error('closing tag without an opening tag');
      }
      if (ch === "'") {
        const nextCh = text[pos + 1];
        if (nextCh === "'") {
          literal += "'";
          pos += 2;
          continue;
        }
        const quotable = nextCh === '{' || nextCh === '}' || nextCh === '<' || nextCh === '>' || (nextCh === '#' && (parentArg === 'plural' || parentArg === 'selectordinal'));
        if (quotable) {
          pos += 1;
          while (pos < text.length) {
            if (text[pos] === "'") {
              if (text[pos + 1] === "'") {
                literal += "'";
                pos += 2;
                continue;
              }
              pos += 1;
              break;
            }
            literal += text[pos];
            pos += 1;
          }
          continue;
        }
      }
      literal += ch;
      pos += 1;
    }
    flush();
    return elements;
  }

  function parseTag(depth, parentArg) {
    const start = pos;
    pos += 1;
    const name = /^[A-Za-z][A-Za-z0-9_-]*/.exec(text.slice(pos))[0];
    pos += name.length;
    skipSpace();
    if (text.startsWith('/>', pos)) {
      pos += 2;
      return { type: 'tag', value: name, children: [] };
    }
    if (peek() !== '>') {
      pos = start;
      error(`malformed tag <${name}`);
    }
    pos += 1;
    const children = parseMessage(depth + 1, parentArg, name);
    if (!text.startsWith(`</${name}>`, pos)) error(`missing closing tag </${name}>`);
    pos += name.length + 3;
    return { type: 'tag', value: name, children };
  }

  function parseArgument(depth) {
    pos += 1; // {
    skipSpace();
    if (peek() === '}') error('empty argument');
    const name = readIdentifier();
    if (name === '') error('expected an argument name');
    skipSpace();
    if (peek() === '}') {
      pos += 1;
      return { type: 'argument', value: name };
    }
    if (peek() !== ',') error(`expected "," or "}" after argument "${name}"`);
    pos += 1;
    skipSpace();
    const type = readIdentifier();
    if (!ARG_TYPES.has(type)) error(`invalid argument type "${type}" in {${name}, ...}`);
    skipSpace();
    if (type === 'number' || type === 'date' || type === 'time') {
      let style = null;
      if (peek() === ',') {
        pos += 1;
        skipSpace();
        const styleStart = pos;
        let styleDepth = 0;
        while (pos < text.length) {
          if (text[pos] === '{') styleDepth += 1;
          if (text[pos] === '}') {
            if (styleDepth === 0) break;
            styleDepth -= 1;
          }
          pos += 1;
        }
        style = text.slice(styleStart, pos).trim();
        if (style === '') error(`empty style in {${name}, ${type}, }`);
      }
      skipSpace();
      if (peek() !== '}') error(`unclosed argument {${name}, ${type}`);
      pos += 1;
      return { type, value: name, style };
    }
    // plural, selectordinal, select
    if (peek() !== ',') error(`expected "," after {${name}, ${type}`);
    pos += 1;
    skipSpace();
    let offset = 0;
    if (type !== 'select' && text.startsWith('offset:', pos)) {
      pos += 'offset:'.length;
      skipSpace();
      const match = /^-?\d+/.exec(text.slice(pos));
      if (!match) error('offset needs a number');
      offset = Number(match[0]);
      pos += match[0].length;
      skipSpace();
    }
    const options = {};
    while (pos < text.length && peek() !== '}') {
      skipSpace();
      const selector = readIdentifier() || (peek() === '=' ? readExact() : '');
      if (selector === '') error(`expected a selector in {${name}, ${type}, ...}`);
      if (Object.hasOwn(options, selector)) error(`duplicate selector "${selector}" in {${name}, ${type}, ...}`);
      skipSpace();
      if (peek() !== '{') error(`expected "{" after selector "${selector}"`);
      pos += 1;
      const value = parseMessage(depth + 1, type, null);
      if (peek() !== '}') error(`unclosed option "${selector}"`);
      pos += 1;
      options[selector] = { value };
      skipSpace();
    }
    if (peek() !== '}') error(`unclosed argument {${name}, ${type}, ...}`);
    pos += 1;
    if (Object.keys(options).length === 0) error(`{${name}, ${type}} has no options`);
    if (requiresOtherClause && !Object.hasOwn(options, 'other')) error(`{${name}, ${type}} needs an "other" option`);
    if (type === 'select') return { type: 'select', value: name, options };
    return { type: 'plural', value: name, pluralType: type === 'plural' ? 'cardinal' : 'ordinal', offset, options };
  }

  function readExact() {
    const match = /^=-?\d+(\.\d+)?/.exec(text.slice(pos));
    if (!match) return '';
    pos += match[0].length;
    return match[0];
  }

  const result = parseMessage(0, null, null);
  if (pos < text.length) error('unexpected text after the message');
  return result;
}

/** Depth-first visit of every element, with the sibling that follows it (null at the end). */
export function walkIcu(elements, visit) {
  elements.forEach((el, index) => {
    visit(el, elements[index + 1] ?? null);
    if (el.type === 'plural' || el.type === 'select') {
      for (const option of Object.values(el.options)) walkIcu(option.value, visit);
    }
    if (el.type === 'tag') walkIcu(el.children, visit);
  });
}

/**
 * Variables with their kind, as FormatJS's structural comparison sees them:
 * argument | number | date | time | plural | select | tag.
 */
export function collectVariables(elements) {
  const vars = new Map();
  walkIcu(elements, (el) => {
    if (el.type === 'literal' || el.type === 'pound') return;
    const kind = el.type === 'plural' ? (el.pluralType === 'ordinal' ? 'selectordinal' : 'plural') : el.type;
    if (!vars.has(el.value)) vars.set(el.value, new Set());
    vars.get(el.value).add(kind);
  });
  return vars;
}

/** The exact (=N) selectors of every plural, by variable name. */
export function exactSelectors(elements) {
  const out = new Map();
  walkIcu(elements, (el) => {
    if (el.type !== 'plural') return;
    const exact = Object.keys(el.options).filter((key) => key.startsWith('='));
    const set = out.get(el.value) ?? new Set();
    for (const key of exact) set.add(key);
    out.set(el.value, set);
  });
  return out;
}
