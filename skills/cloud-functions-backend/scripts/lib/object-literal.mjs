// object-literal.mjs: a tiny reader for object literals in (comment-masked) TypeScript source.
// Not a parser: it tracks brackets and strings, which is enough for config objects such as
// createNativeStackNavigator({ ... }) or <Stack screenOptions={{ ... }}>. Helpers only (not an entry
// point); one canonical copy, synced into every skill that declares it.
//
//   extractBlock(text, openIndex) -> { inner, close } | null    topLevelEntries(inner) -> [{ key, value, offset }]
//   childObject(inner, key) -> inner text | null               callObjectArgument(text, callName) -> { inner, index } | null

const OPEN = { '{': '}', '[': ']', '(': ')' };

/** Index just past the string, template or bracket group that starts at `start`. */
function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') i += 1;
    i += 1;
  }
  return i + 1;
}

/**
 * The text between the bracket at `openIndex` and its partner (exclusive), plus the partner's
 * index. Returns null when the brackets do not balance.
 */
export function extractBlock(text, openIndex) {
  const stack = [];
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i);
      continue;
    }
    if (OPEN[ch]) stack.push(OPEN[ch]);
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return { inner: text.slice(openIndex + 1, i), close: i };
    }
    i += 1;
  }
  return null;
}

/**
 * The top-level `key: value` entries of an object literal's inner text, in order.
 * Each entry is { key, value, offset } where offset is the key's index inside `inner`.
 * Shorthand entries (`Home,`) get value = key.
 */
export function topLevelEntries(inner) {
  const entries = [];
  let depth = 0;
  let start = 0;
  const flush = (end) => {
    const part = inner.slice(start, end);
    const trimmed = part.trim();
    if (trimmed) {
      const offset = start + part.indexOf(trimmed);
      const match = /^(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*(:)?/.exec(trimmed);
      if (match) {
        const key = match[2] ?? match[3];
        const value = match[4] ? trimmed.slice(match[0].length).trim() : key;
        entries.push({ key, value, offset });
      }
    }
    start = end + 1;
  };
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(inner, i);
      continue;
    }
    if (OPEN[ch]) depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) flush(i);
    i += 1;
  }
  flush(inner.length);
  return entries;
}

/** Finds `key: {` at the top level of `inner` and returns that object's inner text (or null). */
export function childObject(inner, key) {
  const entry = topLevelEntries(inner).find((candidate) => candidate.key === key);
  if (!entry || !entry.value.startsWith('{')) return null;
  const block = extractBlock(entry.value, 0);
  return block ? block.inner : null;
}

/** The inner text of the first call argument object: `name({ ... })`. */
export function callObjectArgument(text, callName) {
  const at = text.indexOf(`${callName}(`);
  if (at === -1) return null;
  const brace = text.indexOf('{', at);
  if (brace === -1) return null;
  const block = extractBlock(text, brace);
  return block ? { inner: block.inner, index: brace } : null;
}
