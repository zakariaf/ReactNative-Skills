// maestro-yaml.mjs: a small YAML reader for Maestro flow files (the subset flows use: a header
// document, `---`, then a list of steps; block maps and lists by indentation; inline {a: b} and
// [a, b]; quoted and plain scalars; # comments). Zero dependencies. Every map and list carries a
// non-enumerable `lines` record so checkers can point at the right line.

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

function scalar(raw) {
  const text = raw.trim();
  if (text === '') return null;
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'");
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/** Split an inline collection body on top-level commas. */
function splitTop(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function keyValue(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ':' && (i === text.length - 1 || text[i + 1] === ' ')) return [scalar(text.slice(0, i)), text.slice(i + 1).trim()];
  }
  return null;
}

function withLines(target, lines) {
  Object.defineProperty(target, 'lines', { value: lines, enumerable: false });
  return target;
}

function inline(text, line) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const map = withLines({}, {});
    for (const part of splitTop(trimmed.slice(1, -1))) {
      const pair = keyValue(part);
      if (pair) {
        map[String(pair[0])] = inline(pair[1], line);
        map.lines[String(pair[0])] = line;
      }
    }
    return map;
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const list = splitTop(trimmed.slice(1, -1)).map((part) => inline(part, line));
    return withLines(list, list.map(() => line));
  }
  return scalar(trimmed);
}

/** Parse block lines [{ indent, text, line }] starting at index i with the given indent. */
function block(rows, i, indent) {
  const first = rows[i];
  if (first.text.startsWith('- ') || first.text === '-') {
    const list = withLines([], []);
    while (i < rows.length && rows[i].indent === indent && (rows[i].text.startsWith('- ') || rows[i].text === '-')) {
      const row = rows[i];
      const rest = row.text === '-' ? '' : row.text.slice(2);
      const childIndent = indent + 2;
      if (rest === '') {
        const next = rows[i + 1];
        if (next && next.indent > indent) {
          const [value, end] = block(rows, i + 1, next.indent);
          list.push(value);
          list.lines.push(row.line);
          i = end;
        } else {
          list.push(null);
          list.lines.push(row.line);
          i += 1;
        }
        continue;
      }
      const pair = rest.startsWith('{') || rest.startsWith('[') || rest.startsWith("'") || rest.startsWith('"') ? null : keyValue(rest);
      if (pair) {
        // "- key: value" starts a map whose other keys sit at indent + 2.
        const synthetic = [{ indent: childIndent, text: rest, line: row.line }];
        let j = i + 1;
        while (j < rows.length && rows[j].indent >= childIndent) {
          synthetic.push(rows[j]);
          j += 1;
        }
        const [value] = block(synthetic, 0, childIndent);
        list.push(value);
        list.lines.push(row.line);
        i = j;
      } else {
        list.push(inline(rest, row.line));
        list.lines.push(row.line);
        i += 1;
      }
    }
    return [list, i];
  }
  const map = withLines({}, {});
  while (i < rows.length && rows[i].indent === indent && !rows[i].text.startsWith('- ')) {
    const row = rows[i];
    const pair = keyValue(row.text);
    if (!pair) {
      i += 1;
      continue;
    }
    const [key, rest] = pair;
    map.lines[String(key)] = row.line;
    if (rest !== '') {
      map[String(key)] = inline(rest, row.line);
      i += 1;
      continue;
    }
    const next = rows[i + 1];
    if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))) {
      const [value, end] = block(rows, i + 1, next.indent);
      map[String(key)] = value;
      i = end;
    } else {
      map[String(key)] = null;
      i += 1;
    }
  }
  return [map, i];
}

function rowsOf(lines, offset) {
  const rows = [];
  lines.forEach((raw, index) => {
    const text = stripComment(raw);
    if (text.trim() === '') return;
    rows.push({ indent: text.length - text.trimStart().length, text: text.trim(), line: offset + index + 1 });
  });
  return rows;
}

function parseDocument(lines, offset) {
  const rows = rowsOf(lines, offset);
  if (rows.length === 0) return null;
  return block(rows, 0, rows[0].indent)[0];
}

/**
 * Parse a Maestro flow file. Returns { header, steps, comments, error }:
 * header = the map before `---` (appId, name, tags, env ...), steps = the list after it (each step a
 * map like { tapOn: { id } } or a string like 'killApp'), comments = [{ line, text }] of # comments.
 */
export function parseFlow(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const comments = [];
  lines.forEach((line, index) => {
    const match = /(?:^|\s)#\s?(.*)$/.exec(line);
    if (match && /^\s*#/.test(line)) comments.push({ line: index + 1, text: match[1].trim() });
  });
  const split = lines.findIndex((line) => line.trim() === '---');
  try {
    if (split === -1) return { header: null, steps: parseDocument(lines, 0), comments, error: null };
    const header = parseDocument(lines.slice(0, split), 0);
    const steps = parseDocument(lines.slice(split + 1), split + 1);
    return { header, steps: steps ?? withLines([], []), comments, error: null };
  } catch (error) {
    return { header: null, steps: null, comments, error: String(error?.message ?? error) };
  }
}

/** The command name and argument of one step: 'killApp' or { tapOn: {...} }. */
export function commandOf(step) {
  if (typeof step === 'string') return { name: step, arg: null };
  if (step && typeof step === 'object' && !Array.isArray(step)) {
    const [name] = Object.keys(step);
    return { name: name ?? '', arg: name === undefined ? null : step[name] };
  }
  return { name: '', arg: null };
}
