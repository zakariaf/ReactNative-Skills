// Frontmatter splitting and a strict YAML-subset parser for SKILL.md files.
//
// The subset is what a skill's frontmatter needs and what every YAML parser reads the same way:
//   key: plain value            (no ": " or " #" inside, no leading indicator character)
//   key: "double quoted"        (escapes \" \\ \n \t \uXXXX)
//   key: 'single quoted'        ('' is a quote)
//   key: [a, "b", c]            (flow list of scalars on one line)
//   key:                        followed by indented "- item" lines (a list)
//   key:                        followed by indented "sub: value" lines (a one-level map)
//   # comments and blank lines
// Anything else (block scalars | >, continuation lines, anchors, tabs, nested maps, duplicate
// keys) is reported as an error with its line number.

/**
 * Locate the frontmatter block.
 * Returns { line1Ok, closed, bom, yaml: [{ text, line }], bodyStart (0-based line index), lines }.
 * line1Ok is false when the file does not start with exactly "---" on line 1; in that case the
 * block is still located from the first non-blank line so other checks can run.
 */
export function splitFrontmatter(rawText) {
  const bom = rawText.charCodeAt(0) === 0xfeff;
  const text = (bom ? rawText.slice(1) : rawText).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const line1Ok = !bom && lines[0] === '---';
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  if (start >= lines.length || !/^---\s*$/.test(lines[start])) {
    return { line1Ok, found: false, closed: false, bom, yaml: [], bodyStart: 0, lines };
  }
  let end = start + 1;
  while (end < lines.length && !/^---\s*$/.test(lines[end])) end += 1;
  if (end >= lines.length) {
    return { line1Ok, found: true, closed: false, bom, yaml: [], bodyStart: 0, lines };
  }
  const yaml = [];
  for (let i = start + 1; i < end; i += 1) yaml.push({ text: lines[i], line: i + 1 });
  return { line1Ok, found: true, closed: true, bom, yaml, bodyStart: end + 1, lines };
}

const KEY = /^([A-Za-z0-9][A-Za-z0-9_-]*):(?:[ ]+(.*)|)$/;

function stripTrailingComment(rest) {
  const trimmed = rest.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return { ok: true };
  return { ok: false };
}

/** Parse one scalar value. Returns { value } or { error }. */
export function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return { value: '' };
  const first = value[0];
  if (first === '"') {
    let out = '';
    let i = 1;
    while (i < value.length && value[i] !== '"') {
      if (value[i] === '\\') {
        const esc = value[i + 1];
        const map = { '"': '"', '\\': '\\', '/': '/', n: '\n', t: '\t', r: '\r', 0: '\0', ' ': ' ' };
        if (esc === 'u' && /^[0-9A-Fa-f]{4}$/.test(value.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(value.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        if (!(esc in map)) return { error: `unknown escape \\${esc ?? ''} in a double-quoted value` };
        out += map[esc];
        i += 2;
        continue;
      }
      out += value[i];
      i += 1;
    }
    if (i >= value.length) return { error: 'double-quoted value is not closed on the same line' };
    if (!stripTrailingComment(value.slice(i + 1)).ok) return { error: 'text after the closing double quote' };
    return { value: out, quoted: true };
  }
  if (first === "'") {
    let out = '';
    let i = 1;
    while (i < value.length) {
      if (value[i] === "'") {
        if (value[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        break;
      }
      out += value[i];
      i += 1;
    }
    if (i >= value.length) return { error: 'single-quoted value is not closed on the same line' };
    if (!stripTrailingComment(value.slice(i + 1)).ok) return { error: 'text after the closing single quote' };
    return { value: out, quoted: true };
  }
  if (first === '[') {
    const close = value.lastIndexOf(']');
    if (close === -1) return { error: 'flow list "[" is not closed on the same line' };
    if (!stripTrailingComment(value.slice(close + 1)).ok) return { error: 'text after the closing "]"' };
    const inner = value.slice(1, close).trim();
    if (inner === '') return { value: [] };
    if (/[[\]{}]/.test(inner)) return { error: 'nested lists or maps are outside the YAML subset' };
    const items = [];
    for (const part of splitFlowItems(inner)) {
      const parsed = parseScalar(part);
      if (parsed.error) return parsed;
      items.push(parsed.value);
    }
    return { value: items };
  }
  if (first === '{') return { error: 'flow maps "{...}" are outside the YAML subset' };
  if (first === '|' || first === '>') return { error: 'block scalars (| or >) are outside the YAML subset; write the value on one line' };
  if ('&*!%@`'.includes(first)) return { error: `a value starting with "${first}" is a YAML indicator; wrap the value in double quotes` };
  if ((first === '-' || first === '?' || first === ':') && (value.length === 1 || value[1] === ' ')) {
    return { error: `a value starting with "${first} " is YAML syntax; wrap the value in double quotes` };
  }
  if (/:\s/.test(value) || value.endsWith(':')) return { error: 'a colon followed by a space inside a plain value is invalid YAML; wrap the value in double quotes' };
  if (/\s#/.test(value)) return { error: '" #" starts a YAML comment and cuts the value short; wrap the value in double quotes' };
  return { value };
}

function splitFlowItems(inner) {
  const items = [];
  let current = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((item) => item.trim());
}

/**
 * Parse the frontmatter lines. Returns { data, lines: { key: lineNumber }, errors: [{ line, key, message }] }.
 * A key whose value failed to parse is left out of data (so value checks are skipped for it).
 */
export function parseYamlSubset(yamlLines) {
  const data = {};
  const keyLines = {};
  const errors = [];
  let i = 0;
  while (i < yamlLines.length) {
    const { text, line } = yamlLines[i];
    if (text.trim() === '' || /^\s*#/.test(text)) {
      i += 1;
      continue;
    }
    if (/^\s/.test(text)) {
      errors.push({ line, message: /^\t/.test(text) ? 'tab indentation is not allowed in YAML' : 'indented line without a parent key (continuation lines are outside the YAML subset; keep each value on one line)' });
      i += 1;
      continue;
    }
    const match = KEY.exec(text);
    if (!match) {
      errors.push({ line, message: `"${text.slice(0, 60)}" is not a "key: value" line` });
      i += 1;
      continue;
    }
    const key = match[1];
    const rest = match[2] ?? '';
    if (key in keyLines) errors.push({ line, key, message: `duplicate key "${key}"` });
    keyLines[key] = line;
    i += 1;
    if (rest.trim() === '' || rest.trim().startsWith('#')) {
      // A block list or a one-level map may follow.
      const children = [];
      while (i < yamlLines.length && (/^\s+\S/.test(yamlLines[i].text) || yamlLines[i].text.trim() === '')) {
        if (yamlLines[i].text.trim() !== '') children.push(yamlLines[i]);
        i += 1;
      }
      if (children.length === 0) {
        data[key] = null;
        continue;
      }
      const isList = children.every((child) => /^\s+- /.test(child.text) || /^\s+-$/.test(child.text));
      const isMap = children.every((child) => /^\s+[A-Za-z0-9][A-Za-z0-9_-]*:(\s|$)/.test(child.text));
      const indent = children[0].text.match(/^\s*/)[0];
      let bad = false;
      for (const child of children) {
        if (child.text.includes('\t')) {
          errors.push({ line: child.line, key, message: 'tab indentation is not allowed in YAML' });
          bad = true;
        } else if (child.text.match(/^\s*/)[0] !== indent) {
          errors.push({ line: child.line, key, message: 'nested indentation is outside the YAML subset (one level only)' });
          bad = true;
        }
      }
      if (!isList && !isMap) {
        errors.push({ line: children[0].line, key, message: `the lines under "${key}:" mix list items and map entries` });
        continue;
      }
      if (bad) continue;
      if (isList) {
        const items = [];
        for (const child of children) {
          const parsed = parseScalar(child.text.replace(/^\s+-\s?/, ''));
          if (parsed.error) {
            errors.push({ line: child.line, key, message: parsed.error });
            bad = true;
          } else items.push(parsed.value);
        }
        if (!bad) data[key] = items;
      } else {
        const map = {};
        for (const child of children) {
          const sub = /^\s+([A-Za-z0-9][A-Za-z0-9_-]*):(?:\s+(.*)|)$/.exec(child.text);
          const parsed = parseScalar(sub[2] ?? '');
          if (parsed.error) {
            errors.push({ line: child.line, key, message: parsed.error });
            bad = true;
          } else if (sub[1] in map) {
            errors.push({ line: child.line, key, message: `duplicate key "${key}.${sub[1]}"` });
            bad = true;
          } else map[sub[1]] = parsed.value;
        }
        if (!bad) data[key] = map;
      }
      continue;
    }
    const parsed = parseScalar(rest);
    if (parsed.error) {
      errors.push({ line, key, message: parsed.error });
      continue;
    }
    // A plain value followed by indented lines would be a multi-line scalar.
    if (i < yamlLines.length && /^\s+\S/.test(yamlLines[i].text)) {
      const tabbed = /^\s*\t/.test(yamlLines[i].text);
      errors.push({ line: yamlLines[i].line, key, message: tabbed ? 'tab indentation is not allowed in YAML' : `continuation line under "${key}" (multi-line values are outside the YAML subset; keep the value on one line)` });
      while (i < yamlLines.length && /^\s+\S/.test(yamlLines[i].text)) i += 1;
      continue;
    }
    data[key] = parsed.value;
  }
  return { data, lines: keyLines, errors };
}
