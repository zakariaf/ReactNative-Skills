// persistence-source.mjs: the source model check-persistence works on (a helper, not an entry point).
// Each repo file is read once and lexed lazily with source-scan: `code` has comments and string
// contents blanked (same length), so a pattern never matches inside text or a comment.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { functionsOf, importsOf, matchBracket, resolveSpecifier, scanSource } from './source-scan.mjs';

/** Map rel -> { rel, raw, scan, code, strings, lineOf, imports } (scan computed on first use). */
export function loadSources(root, files) {
  const sources = new Map();
  for (const rel of files) {
    const raw = readFileSync(join(root, rel), 'utf8');
    let scan = null;
    const lazy = () => (scan ??= scanSource(raw));
    sources.set(rel, {
      rel,
      raw,
      get scan() {
        return lazy();
      },
      get code() {
        return lazy().code;
      },
      get strings() {
        return lazy().strings;
      },
      lineOf: (index) => (index < 0 ? 0 : lazy().lineOf(index)),
      get imports() {
        return importsOf(lazy());
      },
    });
  }
  return sources;
}

/** Every index where `pattern` (a global RegExp) matches the blanked code. */
export function codeMatches(src, pattern) {
  return [...src.code.matchAll(pattern)].map((match) => ({ index: match.index, match }));
}

/** The string literal that starts at or after `from` within `limit` characters, or null. */
function stringNear(src, from, limit = 4) {
  return src.strings.find((entry) => entry.index >= from && entry.index <= from + limit) ?? null;
}

/** The value of `const NAME = '...'` (or a template without substitutions) in this file, or null. */
export function constantString(src, name) {
  const match = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=]+)?=\\s*`).exec(src.code);
  if (match === null) return null;
  return stringNear(src, match.index + match[0].length)?.value ?? null;
}

/** Local name -> { spec, name } of every value import `import { A, B as C } from '...'` in the file. */
function importedBindings(src) {
  const bindings = new Map();
  for (const match of src.scan.codeKeep.matchAll(/\bimport\s+(?!type\b)\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    for (const part of match[1].split(',')) {
      const binding = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (binding !== null && !/^\s*type\s/.test(part)) bindings.set(binding[2] ?? binding[1], { spec: match[3], name: binding[1] });
    }
  }
  return bindings;
}

/** The text of the initializer of `const|let NAME = ...;` in this file, or null. */
function initializerOf(src, name) {
  const match = new RegExp(`\\b(?:const|let)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=;]+)?=\\s*`).exec(src.code);
  if (match === null) return null;
  const start = match.index + match[0].length;
  let depth = 0;
  for (let i = start; i < src.code.length; i += 1) {
    const c = src.code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    // A line break ends the statement unless the expression goes on (`cond\n  ? A_SQL\n  : B_SQL`).
    const goesOn = c === '\n' && (/[?:+\-*/|&.=,(]\s*$/.test(src.code.slice(start, i)) || /^\s*[?:+\-*/|&.]/.test(src.code.slice(i + 1, i + 80)));
    if (depth < 0 || (depth === 0 && (c === ';' || (c === '\n' && !goesOn && src.code.slice(start, i).trim() !== '')))) return { text: src.raw.slice(start, i).trim(), start };
  }
  return { text: src.raw.slice(start).trim(), start };
}

/**
 * The SQL an argument expression stands for, or null when it cannot be known statically: a literal,
 * a same-file constant or alias (`const query = SELECT_TASKS_SQL`), or a constant imported from
 * another repo file (resolved through the tsconfig aliases when `ctx` is given).
 */
export function sqlOf(src, text, start, ctx = null, depth = 0) {
  if (depth > 4) return null;
  if (/^['"`]/.test(text)) return stringNear(src, start, 0)?.value ?? null;
  if (!/^[A-Za-z_$][\w$]*$/.test(text)) return null;
  const local = initializerOf(src, text);
  if (local !== null) return sqlOf(src, local.text, local.start, ctx, depth + 1);
  const imported = ctx === null ? undefined : importedBindings(src).get(text);
  if (imported === undefined) return null;
  const isRepoPath = imported.spec.startsWith('.') || ctx.layout.aliases.some((alias) => imported.spec.startsWith(alias.pattern.replace(/\*$/, '')));
  if (!isRepoPath) return null;
  const target = ctx.sources.get(resolveSpecifier(src.rel, imported.spec, { root: ctx.root, aliases: ctx.layout.aliases }) ?? '');
  if (target === undefined) return null;
  const exported = initializerOf(target, imported.name);
  return exported === null ? null : sqlOf(target, exported.text, exported.start, ctx, depth + 1);
}

/**
 * The first argument of the call whose '(' is at `open`: { text, sql, start } where sql is the literal
 * value (inline, through a same-file constant or alias, or with `ctx` through an imported constant)
 * or null when it cannot be known statically, and start is the index where the argument begins.
 */
export function firstArgument(src, open, ctx = null) {
  const close = matchBracket(src.code, open);
  const end = close === -1 ? src.code.length : close;
  let depth = 0;
  let stop = end;
  for (let i = open + 1; i < end; i += 1) {
    const c = src.code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      stop = i;
      break;
    }
  }
  const text = src.raw.slice(open + 1, stop).trim();
  const start = open + 1 + (src.raw.slice(open + 1, stop).length - src.raw.slice(open + 1, stop).trimStart().length);
  return { text, sql: sqlOf(src, text, start, ctx), start };
}

/** Names that hold a driver: the canonical names, `x: SqlDriver`-style annotations, and `= x.driver` / `{ driver: x }`. */
const DRIVER_NAME = /^(?:driver|db|database|reader|connection|conn|sqlite)$|(?:Driver|Db|Database|Reader|Connection)$/;

export function driverNames(src) {
  const names = new Set();
  for (const match of src.code.matchAll(/([A-Za-z_$][\w$]*)\??\s*:\s*(?:Readonly<\s*)?(?:Pick<\s*)?(?:Closable)?Sql(?:Driver|Reader)\b/g)) names.add(match[1]);
  for (const match of src.code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.?]*\.driver\b/g)) names.add(match[1]);
  for (const match of src.code.matchAll(/\bdriver\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/g)) names.add(match[1]);
  return names;
}

const isDriverName = (name, names) => name !== null && (DRIVER_NAME.test(name) || names.has(name));
const SQL_READ = /^\s*(SELECT|WITH|PRAGMA)\b/i;

/**
 * The SqlDriver calls of a file: [{ index, open, method, receiver, sql, text }]. `.run(` and
 * `.transaction(` always count (no other API the app uses has them); `.exec(`, `.get(` and `.all(`
 * count on a driver-named receiver (driver, db, a name annotated SqlDriver, ...) or when their first
 * argument resolves to SQL, so `PATTERN.exec(text)`, `map.get(key)` and `Promise.all(...)` stay out.
 */
export function driverCalls(src, ctx = null) {
  const names = driverNames(src);
  const calls = [];
  for (const match of src.code.matchAll(/(?:(?<![\w$])([A-Za-z_$][\w$]*)|[)\]])?\s*(?:\?\.|!\.|\.)\s*(run|exec|get|all|transaction)\s*\(/g)) {
    const receiver = match[1] ?? null;
    const method = match[2];
    const open = match.index + match[0].length - 1;
    const index = match.index + match[0].indexOf(method) - 1;
    const { text, sql } = method === 'transaction' ? { text: '', sql: null } : firstArgument(src, open, ctx);
    const isDriver =
      method === 'run' || method === 'transaction' || isDriverName(receiver, names) ||
      (method === 'exec' ? driverStatementOf(sql ?? '') !== null : SQL_READ.test(sql ?? ''));
    if (isDriver) calls.push({ index, open, method, receiver, sql, text });
  }
  return calls;
}

/** The smallest function body ({ bodyStart, bodyEnd, name }) that contains `index`, or null. */
export function functionAt(src, index) {
  const bodies = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1 && fn.bodyStart < index && index < fn.bodyEnd);
  return bodies.sort((a, b) => a.bodyEnd - a.bodyStart - (b.bodyEnd - b.bodyStart))[0] ?? null;
}

/** Index of the `return {` that sits directly in a function body (not in a nested callback), or -1. */
export function topLevelReturnObject(src, fn) {
  let depth = 0;
  for (let i = fn.bodyStart; i < fn.bodyEnd; i += 1) {
    const c = src.code[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (depth === 1 && src.code.startsWith('return', i) && /^return\s*\{/.test(src.code.slice(i, i + 12))) return i + src.code.slice(i).indexOf('{');
  }
  return -1;
}

/**
 * The top-level entries of the object literal opening at `open` in the blanked code:
 * [{ key, start, end }] (key is null for a spread or a computed key).
 */
export function objectEntries(src, open) {
  const close = matchBracket(src.code, open);
  if (close === -1) return [];
  const entries = [];
  let depth = 0;
  let start = open + 1;
  const flush = (end) => {
    const text = src.code.slice(start, end);
    if (text.trim() !== '') {
      const key = /^\s*([A-Za-z_$][\w$]*)\s*[:(]/.exec(text)?.[1] ?? null;
      entries.push({ key, start, end });
    }
    start = end + 1;
  };
  for (let i = open + 1; i < close; i += 1) {
    const c = src.code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) flush(i);
  }
  flush(close);
  return entries;
}

/** Identifiers of the array literal assigned to `name` (`export const NAME: T[] = [A, B]`), in order. */
export function arrayIdentifiers(src, name) {
  const match = new RegExp(`\\b${name}\\b[^=;]*=\\s*\\[`).exec(src.code);
  if (match === null) return null;
  const open = match.index + match[0].length - 1;
  const close = matchBracket(src.code, open);
  if (close === -1) return null;
  return src.code
    .slice(open + 1, close)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ name: part, index: open + 1 + src.code.slice(open + 1, close).indexOf(part) }));
}

const SQL_STATEMENT = /\b(INSERT INTO|INSERT OR \w+ INTO|REPLACE INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE|CREATE (?:UNIQUE )?INDEX|ALTER TABLE|DROP TABLE|SELECT [\s\S]+? FROM)\b/;

/**
 * The same statements in any case, each capturing the table it reads or writes. Lowercase SQL counts
 * only when that table is one of the app's own (English like "Select a task from the list" names no
 * table), so the checker stays quiet on prose and still sees `select count(*) from tasks`.
 */
const SQL_ANY_CASE = [
  /\binsert\s+(?:or\s+\w+\s+)?into\s+["`]?(\w+)/gi,
  /\breplace\s+into\s+["`]?(\w+)/gi,
  /\bupdate\s+(?:or\s+\w+\s+)?["`]?(\w+)["`]?\s+set\b/gi,
  /\bdelete\s+from\s+["`]?(\w+)/gi,
  /\b(?:create|alter|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?["`]?(\w+)/gi,
  /\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?\w+\s+on\s+["`]?(\w+)/gi,
  /\bselect\s[\s\S]*?\bfrom\s+["`]?(\w+)/gi,
];

/** The first statement of `text`: uppercase keywords (the house style), or any case on a known table. */
function statementOf(text, tables) {
  const upper = SQL_STATEMENT.exec(text);
  if (upper !== null) return upper[1];
  if (tables === undefined || tables.size === 0) return null;
  for (const pattern of SQL_ANY_CASE) {
    for (const match of text.matchAll(pattern)) {
      if (tables.has(match[1].toLowerCase())) return match[0].replace(/\s+/g, ' ').slice(0, 40);
    }
  }
  return null;
}

const PRAGMA_ANY_CASE = /^\s*pragma\s+\w+/i;

/**
 * The statement a text handed to a driver call (`.run/.get/.all/.exec`) holds, in any case and on any
 * table (sqlite_master included), or null. Prose is never a driver call's first argument, so no table
 * filter is needed here.
 */
export function driverStatementOf(text) {
  const upper = SQL_STATEMENT.exec(text);
  if (upper !== null) return upper[1];
  const pragma = PRAGMA_ANY_CASE.exec(text);
  if (pragma !== null) return pragma[0].trim().replace(/\s+/g, ' ');
  for (const pattern of SQL_ANY_CASE) {
    const [match] = text.matchAll(pattern);
    if (match !== undefined) return match[0].replace(/\s+/g, ' ').slice(0, 40);
  }
  return null;
}

/**
 * String literals of the file that hold an SQL statement: uppercase keywords always, any case when
 * the statement names one of `tables` (the app's own table names, lowercase).
 */
export function sqlStrings(src, tables) {
  return src.strings
    .map((entry) => ({ entry, statement: statementOf(entry.value, tables) }))
    .filter(({ statement }) => statement !== null)
    .map(({ entry, statement }) => ({ ...entry, statement }));
}

/** The app's own table names (lowercase): every table a migration step creates or renames to. */
export function knownTables(sources, isStepFile) {
  const names = new Set();
  for (const src of sources.values()) {
    if (!isStepFile(src.rel)) continue;
    for (const entry of src.strings) {
      for (const table of createTables(entry.value)) names.add(table.name.toLowerCase());
      for (const match of entry.value.matchAll(/\bRENAME\s+TO\s+["`]?(\w+)/gi)) names.add(match[1].toLowerCase());
    }
  }
  return names;
}

/** true for INSERT/UPDATE/REPLACE text: a statement that writes data a schema must have checked. */
export function isDataWrite(sql) {
  return /^\s*(INSERT|REPLACE|UPDATE)\b/i.test(sql ?? '');
}

/** Every `CREATE TABLE name (...)` in a text, with whether STRICT follows the closing parenthesis. */
export function createTables(text) {
  const found = [];
  for (const match of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][\w]*)["`]?\s*\(/gi)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    const tail = close === -1 ? '' : text.slice(close + 1, close + 40);
    found.push({ name: match[1], index: match.index, isStrict: /^\s*(WITHOUT\s+ROWID\s*,\s*)?STRICT\b/i.test(tail) });
  }
  return found;
}

/** Identifiers a binding pattern declares: `x`, `{ a, b: c }` -> a, c, `[d]` -> d (defaults left out). */
export function boundNames(pattern) {
  if (/^[A-Za-z_$][\w$]*$/.test(pattern)) return [pattern];
  const inner = pattern.replace(/=[^,}\]]*/g, '');
  return [...inner.matchAll(/([A-Za-z_$][\w$]*)\s*(?=[,}\]]|$)/g)].map((match) => match[1]).filter((name) => name !== 'readonly');
}

/** The start of the member chain that ends just before `end` (`useAppData().database` in `useAppData().database.driver`). */
export function chainStart(code, end) {
  let i = end - 1;
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i -= 1;
    if (code[i] === ')' || code[i] === ']') {
      const close = code[i];
      const open = close === ')' ? '(' : '[';
      let depth = 0;
      for (; i >= 0; i -= 1) {
        if (code[i] === close) depth += 1;
        else if (code[i] === open && --depth === 0) break;
      }
      i -= 1;
      while (i >= 0 && /[\w$]/.test(code[i])) i -= 1;
    } else if (/[\w$]/.test(code[i] ?? '')) {
      while (i >= 0 && /[\w$]/.test(code[i])) i -= 1;
    } else {
      return i + 1;
    }
    let j = i;
    while (j >= 0 && /\s/.test(code[j])) j -= 1;
    if (code[j] !== '.') return i + 1;
    i = j - 1;
    if (code[i] === '?') i -= 1;
    while (code[i] === '!') i -= 1;
  }
}

/** Index of the end of the statement or expression that starts at `from`: a `;` or `,` at depth 0, or the bracket that closes its parent. */
export function expressionEnd(code, from, { comma = false } = {}) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth < 0) return i;
    } else if (depth === 0 && (c === ';' || (comma && c === ','))) return i;
  }
  return code.length;
}

/**
 * [start, end] of each top-level argument of the call (or parameter list) whose '(' is at `open`.
 * `types: true` also nests `<...>` (a parameter list's generic types, never a call's comparisons).
 */
export function argumentRanges(code, open, { types = false } = {}) {
  const close = matchBracket(code, open);
  const end = close === -1 ? code.length : close;
  const ranges = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < end; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{' || (types && c === '<')) depth += 1;
    else if (c === ')' || c === ']' || c === '}' || (types && c === '>' && code[i - 1] !== '=')) depth -= 1;
    else if (c === ',' && depth === 0) {
      ranges.push([start, i]);
      start = i + 1;
    }
  }
  if (code.slice(start, end).trim() !== '') ranges.push([start, end]);
  return ranges;
}

/** The names each parameter binds, by position: `(a: A, { b, c: d }, ...rest)` -> [['a'], ['b', 'd'], ['rest']]. */
export function paramNamesByPosition(code, open) {
  return argumentRanges(code, open, { types: true }).map(([from, to]) => {
    let depth = 0;
    let cut = to;
    for (let i = from; i < to; i += 1) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{' || c === '<') depth += 1;
      else if (c === ')' || c === ']' || c === '}' || c === '>') depth -= 1;
      else if (depth === 0 && (c === ':' || c === '=' || c === '?')) {
        cut = i;
        break;
      }
    }
    return boundNames(code.slice(from, cut).trim().replace(/^\.\.\./, '').replace(/^(?:readonly|public|private|protected)\s+/, ''));
  });
}
