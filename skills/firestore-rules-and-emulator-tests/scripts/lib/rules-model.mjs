// rules-model.mjs: a small reader for Firebase security rules files (Firestore and Storage) and for
// the Jest files that test them. It reads source text, not a parsed program: enough to find match
// blocks, their allow statements and conditions, and the describe blocks that name a match path.

/** Blanks comments (and, with `blankStrings`, string contents) without moving any line or column. */
export function maskRules(text, { blankStrings = false } = {}) {
  let out = '';
  let i = 0;
  const blank = (part) => part.replace(/[^\n]/g, ' ');
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      const inner = text.slice(i + 1, j);
      out += ch + (blankStrings ? blank(inner) : inner) + (text[j] === ch ? ch : '');
      i = text[j] === ch ? j + 1 : j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

const PREFIXES = {
  firestore: /^\/databases\/\{[^}/]+\}\/documents(?=\/|$)/,
  storage: /^\/b\/\{[^}/]+\}\/o(?=\/|$)/,
};

/** The path a test names: the full match path without the service prefix and the leading slash. */
export function testPathOf(fullPath, service) {
  return fullPath.replace(PREFIXES[service], '').replace(/^\/+/, '');
}

const TOKEN = /\bmatch\s+(\/(?:[^\s{}]|\{[^\s{}]*\})*)\s*\{|\bservice\s+[\w.]+\s*\{|\bfunction\s+\w+\s*\([^)]*\)\s*\{|\ballow\s+([a-z]+(?:\s*,\s*[a-z]+)*)\s*(:\s*if\b([\s\S]*?))?;|\{|\}/g;

/**
 * Match blocks of a rules file, outermost first. Each: { path (test path), fullPath, written (the
 * path as its match statement writes it), line, allows, declarations (the functions, matches and
 * allows directly in its body: the rules compiler refuses a body with none), recursive (this block or
 * an enclosing one has a `=**` wildcard) }; each allow: { methods, condition (null when the statement
 * has none), line }.
 */
export function parseRules(text, service) {
  const structure = maskRules(text, { blankStrings: true });
  const readable = maskRules(text);
  const stack = [];
  const blocks = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(structure); match !== null; match = TOKEN.exec(structure)) {
    const token = match[0];
    const enclosing = stack.at(-1);
    if (enclosing?.type === 'match' && /^(?:match|function|allow)\b/.test(token)) enclosing.block.declarations += 1;
    if (token.startsWith('match')) {
      const parent = [...stack].reverse().find((frame) => frame.type === 'match');
      const fullPath = `${parent ? parent.block.fullPath : ''}${match[1]}`;
      const block = {
        path: testPathOf(fullPath, service),
        fullPath,
        written: match[1],
        line: lineAt(structure, match.index),
        allows: [],
        declarations: 0,
        recursive: /=\*\*\}/.test(fullPath),
      };
      blocks.push(block);
      stack.push({ type: 'match', block });
    } else if (token.startsWith('service')) {
      stack.push({ type: 'service' });
    } else if (token.startsWith('function')) {
      stack.push({ type: 'function' });
    } else if (token.startsWith('allow')) {
      const top = stack.at(-1);
      if (top?.type !== 'match') continue;
      const conditionStart = match[3] === undefined ? -1 : match.index + token.indexOf(match[3]) + match[3].indexOf('if') + 2;
      const condition = conditionStart === -1 ? null : readable.slice(conditionStart, match.index + token.length - 1).replace(/\s+/g, ' ').trim();
      top.block.allows.push({
        methods: match[2].split(',').map((method) => method.trim()),
        condition,
        line: lineAt(structure, match.index),
      });
    } else if (token === '{') {
      stack.push({ type: 'other' });
    } else {
      stack.pop();
    }
  }
  return blocks;
}

const WRITE_METHODS = new Set(['write', 'create', 'update', 'delete']);

export const isWrite = (allow) => allow.methods.some((method) => WRITE_METHODS.has(method));

/** Strips whitespace and the parentheses around a whole condition. */
function normalized(condition) {
  let text = condition.replace(/\s+/g, '');
  while (/^\(.*\)$/.test(text) && balanced(text.slice(1, -1))) text = text.slice(1, -1);
  return text;
}

function balanced(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export const grantsNothing = (allow) => allow.condition !== null && normalized(allow.condition) === 'false';

/** Why an allow is open to everyone, or null. */
export function openReason(allow) {
  if (allow.condition === null) return 'has no condition, so it is always true';
  const text = normalized(allow.condition);
  if (text === 'true' || /(^|\|\|)\(*true\)*(\|\||$)/.test(text)) return 'is `if true` for everyone';
  if (/request\.time<timestamp\.date\(/.test(text)) return "is the console's time-limited test-mode rule (open to everyone until a date)";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Test files
// ---------------------------------------------------------------------------------------------

/** Index just past the `)` that closes the `(` at `open`, skipping strings and template literals. */
export function closeOfCall(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

const DESCRIBE = /\b(x?describe)((?:\.\w+)*)\s*\(\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
const SKIPPED_CALL = /\b(?:xit|xtest|(?:it|test)\.skip|(?:it|test)\.todo)\s*\(/g;

/**
 * The describe blocks of a test file (comments masked by the caller): { title, line, succeeds,
 * fails }. A skipped describe (`describe.skip`, `xdescribe`) and assertions inside a skipped `it`
 * do not count: a test that never runs proves nothing.
 */
export function readDescribes(masked) {
  const found = [];
  DESCRIBE.lastIndex = 0;
  for (let match = DESCRIBE.exec(masked); match !== null; match = DESCRIBE.exec(masked)) {
    const modifiers = match[2].split('.').filter(Boolean);
    if (match[1] === 'xdescribe' || modifiers.includes('skip') || modifiers.includes('each')) continue;
    const open = masked.indexOf('(', match.index);
    let body = masked.slice(open, closeOfCall(masked, open));
    SKIPPED_CALL.lastIndex = 0;
    const cuts = [];
    for (let skip = SKIPPED_CALL.exec(body); skip !== null; skip = SKIPPED_CALL.exec(body)) {
      const start = body.indexOf('(', skip.index);
      cuts.push([skip.index, closeOfCall(body, start)]);
    }
    for (const [start, end] of cuts.reverse()) body = body.slice(0, start) + body.slice(end);
    found.push({
      title: match[4],
      line: lineAt(masked, match.index),
      succeeds: (body.match(/\bassertSucceeds\s*\(/g) ?? []).length,
      fails: (body.match(/\bassertFails\s*\(/g) ?? []).length,
    });
  }
  return found;
}

/** Does a describe title name this match path (the path as a whole, not as part of a longer one)? */
export function titleNames(title, path) {
  if (path === '') return false;
  for (let at = title.indexOf(path); at !== -1; at = title.indexOf(path, at + 1)) {
    const before = at === 0 ? '' : title[at - 1];
    const after = title[at + path.length] ?? '';
    if (!/[\w/{}=*.-]/.test(before) && !/[\w/{}=*-]/.test(after)) return true;
  }
  return false;
}
