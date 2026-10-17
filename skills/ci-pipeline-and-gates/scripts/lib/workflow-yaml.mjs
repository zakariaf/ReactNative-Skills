// workflow-yaml.mjs: a zero-dependency parser for the YAML that GitHub Actions workflows and
// dependabot.yml are written in, keeping the line of every key and value and the comment after a
// scalar (the "# v7.0.1" after a SHA-pinned action). It reads block mappings and sequences, plain,
// single- and double-quoted scalars, literal and folded block scalars (| |- |+ > >- >+), and flow
// sequences and mappings ([a, b], { a: b }) on one or more lines. It does not read anchors, aliases,
// tags or multiple documents: a workflow that needs them is reported as a syntax problem by the
// caller, never guessed. Keys stay strings ("on" is the key on, never the boolean true).

/** A parse error with the 1-based line it was found on. */
export class YamlError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'YamlError';
    this.line = line;
  }
}

const isBlankOrComment = (text) => /^\s*(#.*)?$/.test(text);

/** Splits one line into its content and its trailing comment (a # after a space, outside quotes). */
export function splitComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") i += 1;
        else quote = null;
      } else if (ch === '\\' && quote === '"') i += 1;
      continue;
    }
    if ((ch === '"' || ch === "'") && (i === 0 || /[\s[{,:-]/.test(text[i - 1]))) quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return { content: text.slice(0, i).replace(/\s+$/, ''), comment: text.slice(i + 1).trim() };
    }
  }
  return { content: text.replace(/\s+$/, ''), comment: null };
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s'"#\-[\]{},][^#]*?|-[^\s][^#]*?)\s*:(?:\s+(.*)|)$/;

function unquote(raw, line) {
  if (raw.startsWith("'")) {
    if (!raw.endsWith("'") || raw.length < 2) throw new YamlError(`unterminated single-quoted string ${raw}`, line);
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (raw.startsWith('"')) {
    if (!raw.endsWith('"') || raw.length < 2) throw new YamlError(`unterminated double-quoted string ${raw}`, line);
    return raw.slice(1, -1).replace(/\\(["\\/nrt0]|u[0-9a-fA-F]{4})/g, (_, esc) => {
      if (esc.startsWith('u')) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
      return { n: '\n', r: '\r', t: '\t', 0: '\0' }[esc] ?? esc;
    });
  }
  return raw;
}

function scalar(raw, line, comment = null) {
  const text = raw.trim();
  if (/^[&*!]/.test(text)) throw new YamlError(`anchors, aliases and tags are not supported (${text.slice(0, 20)})`, line);
  const style = text.startsWith("'") ? 'single' : text.startsWith('"') ? 'double' : 'plain';
  return { type: 'scalar', value: unquote(text, line), style, line, comment, empty: text === '' };
}

// ---------------------------------------------------------------------------------------------
// Flow collections
// ---------------------------------------------------------------------------------------------

function parseFlow(text, line) {
  let i = 0;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  const readScalar = (stops) => {
    skip();
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === quote) {
          if (quote === "'" && text[j + 1] === "'") j += 2;
          else break;
        } else if (text[j] === '\\' && quote === '"') j += 2;
        else j += 1;
      }
      if (j >= text.length) throw new YamlError('unterminated string in a flow collection', line);
      const raw = text.slice(i, j + 1);
      i = j + 1;
      return scalar(raw, line);
    }
    let j = i;
    while (j < text.length && !stops.includes(text[j])) {
      if (text[j] === ':' && stops.includes(':') && /[\s,\]}]/.test(text[j + 1] ?? ' ')) break;
      j += 1;
    }
    const raw = text.slice(i, j);
    i = j;
    return scalar(raw, line);
  };
  const readValue = (stops) => {
    skip();
    if (text[i] === '[') return readSeq();
    if (text[i] === '{') return readMap();
    return readScalar(stops);
  };
  function readSeq() {
    i += 1;
    const items = [];
    for (;;) {
      skip();
      if (text[i] === ']') {
        i += 1;
        return { type: 'seq', items, line, flow: true };
      }
      if (i >= text.length) throw new YamlError('unterminated flow sequence [', line);
      items.push(readValue([',', ']']));
      skip();
      if (text[i] === ',') i += 1;
      else if (text[i] !== ']') throw new YamlError(`unexpected ${JSON.stringify(text[i] ?? 'end')} in a flow sequence`, line);
    }
  }
  function readMap() {
    i += 1;
    const entries = [];
    for (;;) {
      skip();
      if (text[i] === '}') {
        i += 1;
        return { type: 'map', entries, line, flow: true };
      }
      if (i >= text.length) throw new YamlError('unterminated flow mapping {', line);
      const key = readScalar([':', ',', '}']);
      skip();
      let value = scalar('', line);
      if (text[i] === ':') {
        i += 1;
        value = readValue([',', '}']);
      }
      entries.push({ key: key.value, line, value });
      skip();
      if (text[i] === ',') i += 1;
      else if (text[i] !== '}') throw new YamlError(`unexpected ${JSON.stringify(text[i] ?? 'end')} in a flow mapping`, line);
    }
  }
  const node = readValue([]);
  skip();
  if (i < text.length) throw new YamlError(`unexpected text after a flow collection: ${text.slice(i, i + 20)}`, line);
  return node;
}

const flowDepth = (text) => {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') i += 1;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
  }
  return depth;
};

// ---------------------------------------------------------------------------------------------
// Block structure
// ---------------------------------------------------------------------------------------------

/**
 * Parses a workflow file. Returns the root node: { type: 'map' | 'seq' | 'scalar', line, ... }.
 * map: entries [{ key, line, value }]; seq: items [node]; scalar: { value, style, comment, empty,
 * block? }. Throws YamlError with the line on anything it does not understand.
 */
export function parseYaml(text) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  if (raw[0]?.charCodeAt(0) === 0xfeff) raw[0] = raw[0].slice(1);
  if (raw.some((line) => /^\t/.test(line) || /^ *\t/.test(line))) {
    const at = raw.findIndex((line) => /^ *\t/.test(line));
    throw new YamlError('a tab in the indentation (YAML allows spaces only)', at + 1);
  }
  // lines[i] = { indent, content, comment, no } or null for blank/comment-only lines
  const lines = raw.map((textLine, index) => {
    if (isBlankOrComment(textLine)) return null;
    if (/^(---|\.\.\.)\s*$/.test(textLine)) return null;
    const indent = textLine.length - textLine.trimStart().length;
    const { content, comment } = splitComment(textLine.slice(indent));
    return { indent, content, comment, no: index + 1 };
  });
  const docStarts = raw.filter((line) => /^---\s*$/.test(line)).length;
  if (docStarts > 1) throw new YamlError('more than one YAML document', raw.findIndex((l, i) => i > 0 && /^---\s*$/.test(l)) + 1);

  const next = (i) => {
    let j = i;
    while (j < lines.length && lines[j] === null) j += 1;
    return j;
  };

  function blockScalar(header, keyIndent, start, line) {
    const m = /^([|>])([+-]?)([1-9]?)([+-]?)$/.exec(header);
    if (!m) throw new YamlError(`unsupported block scalar header ${header}`, line);
    const folded = m[1] === '>';
    const chomp = m[2] || m[4];
    const body = [];
    let j = start;
    let contentIndent = m[3] ? keyIndent + Number(m[3]) : null;
    while (j < raw.length) {
      const textLine = raw[j];
      if (textLine.trim() === '') {
        body.push('');
        j += 1;
        continue;
      }
      const indent = textLine.length - textLine.trimStart().length;
      if (indent <= keyIndent) break;
      if (contentIndent === null) contentIndent = indent;
      if (indent < contentIndent) break;
      body.push(textLine.slice(contentIndent));
      j += 1;
    }
    while (body.length > 0 && body[body.length - 1] === '' && chomp !== '+') body.pop();
    let value = folded
      ? body.reduce((out, part, k) => (k === 0 ? part : part === '' || body[k - 1] === '' ? `${out}\n${part}` : `${out} ${part}`), '')
      : body.join('\n');
    if (chomp !== '-' && body.length > 0) value += '\n';
    // mark the consumed raw lines so block structure never reads them
    for (let k = start; k < j; k += 1) lines[k] = null;
    return { node: { type: 'scalar', value, style: folded ? 'folded' : 'literal', block: true, line, bodyLine: start + 1, comment: null, empty: false }, end: j };
  }

  function inlineValue(rest, comment, indent, i, line) {
    // a value written after "key:" or "- " on line i; returns { node, end }
    if (/^[|>]/.test(rest)) return blockScalar(rest, indent, i + 1, line);
    if (rest.startsWith('[') || rest.startsWith('{')) {
      let text = rest;
      let j = i + 1;
      while (flowDepth(text) > 0) {
        j = next(j);
        if (j >= lines.length) throw new YamlError('unterminated flow collection', line);
        text += ` ${lines[j].content}`;
        lines[j] = null;
        j += 1;
      }
      return { node: parseFlow(text, line), end: i + 1 };
    }
    return { node: scalar(rest, line, comment), end: i + 1 };
  }

  function parseBlock(i, parentIndent) {
    const j = next(i);
    if (j >= lines.length || lines[j].indent <= parentIndent) return null;
    const { indent, content } = lines[j];
    return content === '-' || content.startsWith('- ') ? parseSeq(j, indent) : parseMap(j, indent);
  }

  function parseMap(i, indent) {
    const node = { type: 'map', entries: [], line: lines[i].no };
    let j = i;
    for (;;) {
      j = next(j);
      if (j >= lines.length) break;
      const l = lines[j];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError(`unexpected indentation (${l.indent} spaces, expected ${indent})`, l.no);
      if (l.content === '-' || l.content.startsWith('- ')) break;
      const m = KEY.exec(l.content);
      if (!m) throw new YamlError(`expected "key: value", found ${JSON.stringify(l.content.slice(0, 40))}`, l.no);
      const key = unquote(m[1].trim(), l.no);
      if (node.entries.some((entry) => entry.key === key)) throw new YamlError(`duplicate key "${key}"`, l.no);
      const rest = (m[2] ?? '').trim();
      if (rest === '') {
        const k = next(j + 1);
        const child = k < lines.length && (lines[k].indent > indent || (lines[k].indent === indent && (lines[k].content === '-' || lines[k].content.startsWith('- '))))
          ? lines[k].indent === indent ? parseSeq(k, indent) : parseBlock(j + 1, indent)
          : null;
        node.entries.push({ key, line: l.no, value: child ?? { type: 'scalar', value: '', style: 'plain', line: l.no, comment: l.comment, empty: true } });
        j += 1;
        if (child) j = child.end;
        continue;
      }
      const { node: value, end } = inlineValue(rest, l.comment, indent, j, l.no);
      node.entries.push({ key, line: l.no, value });
      j = end;
    }
    node.end = j;
    return node;
  }

  function parseSeq(i, indent) {
    const node = { type: 'seq', items: [], line: lines[i].no };
    let j = i;
    for (;;) {
      j = next(j);
      if (j >= lines.length) break;
      const l = lines[j];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError(`unexpected indentation (${l.indent} spaces, expected ${indent})`, l.no);
      if (!(l.content === '-' || l.content.startsWith('- '))) break;
      const rest = l.content === '-' ? '' : l.content.slice(2).trimStart();
      if (rest === '') {
        const child = parseBlock(j + 1, indent);
        node.items.push(child ?? scalar('', l.no));
        j = child ? child.end : j + 1;
        continue;
      }
      const offset = l.content.length - rest.length;
      if (!/^[[{]/.test(rest) && KEY.test(rest)) {
        // "- key: value": a mapping whose first entry sits on the dash line
        lines[j] = { ...l, indent: indent + offset, content: rest };
        const child = parseMap(j, indent + offset);
        node.items.push(child);
        j = child.end;
        continue;
      }
      const { node: value, end } = inlineValue(rest, l.comment, indent, j, l.no);
      node.items.push(value);
      j = end;
    }
    node.end = j;
    return node;
  }

  const start = next(0);
  if (start >= lines.length) return { type: 'map', entries: [], line: 1, end: 0 };
  const root = lines[start].content.startsWith('- ') ? parseSeq(start, lines[start].indent) : parseMap(start, lines[start].indent);
  const rest = next(root.end);
  if (rest < lines.length) throw new YamlError(`unexpected content ${JSON.stringify(lines[rest].content.slice(0, 40))}`, lines[rest].no);
  return root;
}

// ---------------------------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------------------------

/** The entry of `key` in a map node, or null. */
export function entryOf(node, key) {
  if (node?.type !== 'map') return null;
  return node.entries.find((entry) => entry.key === key) ?? null;
}

/** The value node of `key` in a map node, or null. */
export function valueOf(node, key) {
  return entryOf(node, key)?.value ?? null;
}

/** A scalar node's string, or null (missing key, empty value, or not a scalar). */
export function textOf(node) {
  return node?.type === 'scalar' && !node.empty ? node.value : null;
}

/** Plain JavaScript data for a node (maps become objects, sequences arrays, scalars strings). */
export function toJs(node) {
  if (!node) return null;
  if (node.type === 'map') return Object.fromEntries(node.entries.map((entry) => [entry.key, toJs(entry.value)]));
  if (node.type === 'seq') return node.items.map(toJs);
  return node.empty ? null : node.value;
}
