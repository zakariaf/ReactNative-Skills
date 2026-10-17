// push-source.mjs: loads what check-push reads: the app's source files (comments masked), the push
// contract, the auth contract and the app config, plus small text helpers. Zero dependencies.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lineOf, maskComments, matchGlob, parseJsonc, readText, toPosix, walkRepo } from '../check-lib.mjs';
import { isTestFile } from './source-scan.mjs';

/** The APIs that request, rotate or deliver a remote push token: their presence means push is built. */
export const TOKEN_APIS = ['getExpoPushTokenAsync', 'getDevicePushTokenAsync', 'addPushTokenListener'];

/** expo-notifications APIs that belong to the push adapter only. */
export const ADAPTER_APIS = [
  ...TOKEN_APIS,
  'setNotificationHandler',
  'addNotificationResponseReceivedListener',
  'getLastNotificationResponse',
  'getLastNotificationResponseAsync',
  'useLastNotificationResponse',
  'clearLastNotificationResponse',
  'requestPermissionsAsync',
  'getPermissionsAsync',
  'unregisterForNotificationsAsync',
];

export const ADAPTER_FILE = /-adapter(?:\.(?:ios|android|native|web))?\.tsx?$/;

/** The text of a repo file, or null when it does not exist (or is binary). */
export function readTextIfExists(path) {
  return existsSync(path) ? readText(path) : null;
}

/** Escapes a string for a RegExp. */
export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 1-based line of the first match of `pattern` (a RegExp or string) in `text`, or 1. */
export function lineAtMatch(text, pattern) {
  const index = typeof pattern === 'string' ? text.indexOf(pattern) : text.search(pattern);
  return index < 0 ? 1 : lineOf(text, index);
}

/** Every index where `name(` is called (not defined, not a member of another name). */
export function callIndexes(code, name) {
  const re = new RegExp(`(?<![\\w$])${escapeRegExp(name)}\\s*\\(`, 'g');
  const found = [];
  for (const match of code.matchAll(re)) {
    const before = code.slice(Math.max(0, match.index - 20), match.index);
    if (/function\s+$/.test(before)) continue;
    found.push(match.index);
  }
  return found;
}

/** The index just after the bracket that closes the one at `open` (strings and templates skipped). */
export function closingIndex(code, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let quote = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (pairs[ch] !== undefined) stack.push(pairs[ch]);
    else if (ch === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return code.length;
}

/** The text between the brackets of the first `<open>` at or after `from`, or null. */
export function bracketBody(code, from, open = '(') {
  const start = code.indexOf(open, from);
  if (start < 0) return null;
  return { start, end: closingIndex(code, start), text: code.slice(start + 1, closingIndex(code, start) - 1) };
}

/** Names this file imports from expo-notifications, and whether it imports the namespace. */
export function expoNotificationsImports(code) {
  const names = new Set();
  let namespace = null;
  const re = /import\s+(type\s+)?([^;]*?)\s+from\s+['"]expo-notifications['"]/g;
  for (const match of code.matchAll(re)) {
    if (match[1] !== undefined) continue;
    const clause = match[2];
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns !== null) namespace = ns[1];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces !== null) {
      for (const part of braces[1].split(',')) {
        const spec = part.trim().replace(/^type\s+/, '');
        if (spec === '' || part.trim().startsWith('type ')) continue;
        names.add(spec.split(/\s+as\s+/)[0].trim());
      }
    }
  }
  const required = /require\(\s*['"]expo-notifications['"]\s*\)/.test(code);
  return { names, namespace, any: names.size > 0 || namespace !== null || required, required };
}

/** Indexes where this file uses an expo-notifications API (named import or Namespace.api). */
export function apiUses(src, apis) {
  const uses = [];
  const { names, namespace } = src.expo;
  for (const api of apis) {
    if (names.has(api)) {
      for (const index of callIndexes(src.code, api)) uses.push({ api, index });
      if (callIndexes(src.code, api).length === 0) uses.push({ api, index: src.code.search(new RegExp(`\\b${api}\\b`)) });
    }
    if (namespace !== null) {
      const re = new RegExp(`\\b${escapeRegExp(namespace)}\\s*\\.\\s*${api}\\b`, 'g');
      for (const match of src.code.matchAll(re)) uses.push({ api, index: match.index });
    }
  }
  return uses;
}

/** App source files under srcDir: { rel, text, code (comments masked), isTest, isAdapter, expo }. */
export function loadSources(root, layout) {
  const files = walkRepo(root, { include: [`${layout.srcDir}/**/*.ts`, `${layout.srcDir}/**/*.tsx`] }).filter(
    (rel) => !rel.endsWith('.d.ts'),
  );
  return files.map((rel) => {
    const text = readTextIfExists(join(root, rel)) ?? '';
    const code = maskComments(text);
    return {
      rel,
      text,
      code,
      isTest: isTestFile(rel) || matchGlob(rel, `${layout.testDir}/**`),
      isAdapter: ADAPTER_FILE.test(rel) && rel.startsWith(`${layout.servicesDir}/`),
      expo: expoNotificationsImports(code),
    };
  });
}

/** Reads a JSON file: { rel, text, data } or { rel, text, error } or null when missing. */
export function readJsonFile(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  try {
    return { rel: toPosix(rel), text, data: parseJsonc(text) };
  } catch (error) {
    return { rel: toPosix(rel), text, error: error.message };
  }
}

/** The app config: app.config.ts/.js/.mjs or app.json, as text with comments masked. */
export function readAppConfig(root) {
  for (const rel of ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.json']) {
    const text = readTextIfExists(join(root, rel));
    if (text !== null) return { rel, text, code: rel.endsWith('.json') ? text : maskComments(text) };
  }
  return null;
}

/** The value of `key` in an options object text: a string literal, or a same-file string const. */
export function optionValue(objectText, key, wholeCode) {
  const re = new RegExp(`["']?${key}["']?\\s*:\\s*([^,}\\n]+)`);
  const match = re.exec(objectText);
  if (match === null) return { present: false, value: null };
  const raw = match[1].trim();
  const literal = /^(['"`])([^'"`]*)\1$/.exec(raw);
  if (literal !== null) return { present: true, value: literal[2] };
  const ident = /^[A-Za-z_$][\w$]*$/.exec(raw);
  if (ident !== null) {
    const decl = new RegExp(`const\\s+${escapeRegExp(raw)}\\s*(?::[^=]+)?=\\s*(['"\`])([^'"\`]*)\\1`).exec(wholeCode);
    if (decl !== null) return { present: true, value: decl[2] };
  }
  return { present: true, value: null };
}

/** The string literals of an array literal's text. */
export function stringItems(arrayText) {
  return [...arrayText.matchAll(/(['"])([^'"]*)\1/g)].map((match) => match[2]);
}
