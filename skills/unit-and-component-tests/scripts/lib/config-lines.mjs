// lib/config-lines.mjs: line numbers for problems found in loaded config files. check-test-setup
// loads jest.config.js (it runs) and parses package.json and stryker.config.json, so a problem knows
// the key or value that is wrong but not where it is written. These helpers find that line in the
// file's text: by key path in JSON, by needle (and by Jest project) in JavaScript. When nothing
// matches, line 1 (the top of the file, where a missing entry belongs).

/** Map from a JSON key path (keys joined with "\u0001") to the 1-based line of the key. Comments allowed. */
export function jsonKeyLines(text) {
  const lines = new Map();
  const stack = [];
  let line = 1;
  const pathKey = () => stack.map((entry) => (entry.kind === '{' ? entry.key : String(entry.index))).join('\u0001');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') {
      line += 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let k = i; k < stop; k += 1) if (text[k] === '\n') line += 1;
      i = stop - 1;
    } else if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') {
        value += text[j] === '\\' ? text[j + 1] ?? '' : text[j];
        j += text[j] === '\\' ? 2 : 1;
      }
      let k = j + 1;
      while (k < text.length && /[ \t\r\n]/.test(text[k])) k += 1;
      const top = stack.at(-1);
      if (top?.kind === '{' && text[k] === ':') {
        top.key = value;
        if (!lines.has(pathKey())) lines.set(pathKey(), line);
      }
      i = j;
    } else if (ch === '{' || ch === '[') {
      stack.push({ kind: ch, key: '', index: 0 });
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    } else if (ch === ',' && stack.at(-1)?.kind === '[') {
      stack.at(-1).index += 1;
    }
  }
  return lines;
}

/**
 * Locator for a JSON file: `at(['devDependencies', 'jest'], ['devDependencies'])` is the line of the
 * first key path that exists, else 1.
 */
export function jsonLocator(text) {
  const lines = jsonKeyLines(text ?? '');
  return {
    at: (...paths) => {
      for (const path of paths) {
        const line = lines.get(path.join('\u0001'));
        if (line) return line;
      }
      return 1;
    },
  };
}

const matchesLine = (needle, text) => (typeof needle === 'string' ? text.includes(needle) : needle.test(text));

/** Index of the brace that closes the one at `open`, skipping string and template literals; -1 when unbalanced. */
function closingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      i = j;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Locator for a JavaScript config (pass it comment-masked code): `line(...needles)` is the first line
 * holding the first needle that occurs (a string or a RegExp, tested line by line), else 1 (`first`:
 * else 0).
 * `inProject(name, ...needles)` looks in the object literal of the Jest project whose displayName is
 * `name`, then outside every project literal (shared objects such as SHARED), then answers the
 * displayName line: a key one project lacks never points at another project's line.
 * `inOwnProject(name, ...needles)` searches only the project's own literal.
 */
export function jsLocator(text) {
  const source = text ?? '';
  const lines = source.split('\n');
  const starts = [];
  for (let i = 0, at = 0; i < lines.length; i += 1) {
    starts.push(at);
    at += lines[i].length + 1;
  }
  const lineAt = (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const find = (needle, keep = () => true) => {
    for (let i = 0; i < lines.length; i += 1) if (keep(i) && matchesLine(needle, lines[i])) return i + 1;
    return 0;
  };
  /** Line of the first needle that occurs, or 0. */
  const first = (...needles) => {
    for (const needle of needles) {
      const found = find(needle);
      if (found) return found;
    }
    return 0;
  };
  const line = (...needles) => first(...needles) || 1;
  // Each project literal: from the "{" that opens the object holding a displayName to its "}".
  const blocks = [];
  for (const match of source.matchAll(/displayName\s*:\s*['"`]([^'"`]+)['"`]/g)) {
    let open = -1;
    for (let depth = 0, i = match.index; i >= 0; i -= 1) {
      if (source[i] === '}') depth += 1;
      else if (source[i] === '{') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth -= 1;
      }
    }
    const close = open === -1 ? -1 : closingBrace(source, open);
    blocks.push({ name: match[1], at: lineAt(match.index), from: open === -1 ? lineAt(match.index) : lineAt(open), to: close === -1 ? lines.length - 1 : lineAt(close) });
  }
  const inProject = (name, ...needles) => {
    const own = blocks.find((block) => block.name === name);
    if (own) {
      for (const needle of needles) {
        const found = find(needle, (i) => i >= own.from && i <= own.to);
        if (found) return found;
      }
    }
    const outside = (i) => !blocks.some((block) => i >= block.from && i <= block.to);
    for (const needle of needles) {
      const found = find(needle, outside);
      if (found) return found;
    }
    return own ? own.at + 1 : 1;
  };
  /** Like inProject, for a key the project sets itself (testMatch, setupFilesAfterEnv): never outside its literal. */
  const inOwnProject = (name, ...needles) => {
    const own = blocks.find((block) => block.name === name);
    if (!own) return 1;
    for (const needle of needles) {
      const found = find(needle, (i) => i >= own.from && i <= own.to);
      if (found) return found;
    }
    return own.at + 1;
  };
  return { first, line, inProject, inOwnProject };
}
