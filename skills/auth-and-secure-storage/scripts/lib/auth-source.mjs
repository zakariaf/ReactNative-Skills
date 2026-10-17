// auth-source.mjs: source loading and small text helpers for check-auth.mjs (zero dependencies).
// Each source keeps three views of a file: `text` (as written), `code` (comments blanked, strings kept,
// for rules that read string contents) and `masked` (comments and string contents blanked, for rules
// that read identifiers and calls). All three keep every offset and newline, so line numbers agree.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lineOf, maskComments } from '../check-lib.mjs';
import { findClosing, findImports, isTestFile, maskCode } from './source-scan.mjs';

/** The packages this skill governs: each may be imported only by its adapter. */
export const AUTH_PACKAGES = Object.freeze(['expo-secure-store', 'expo-auth-session', 'expo-apple-authentication']);

/** Storage that is not encrypted at rest with a hardware-backed key: never a home for a token. */
export const PLAIN_STORAGE_PACKAGES = Object.freeze([
  'expo-sqlite',
  'expo-sqlite/kv-store',
  '@react-native-async-storage/async-storage',
  'react-native-mmkv',
  'expo-file-system',
]);

/** Identifiers and keys that name a credential or secret value (words in prose such as "refreshed tokens" do not). */
export const TOKEN_PATTERN = /\b(?:access|refresh|id|identity|bearer|auth|session)[_-]?token\b|\bpassword\b|\bauthorization[_-]?code\b|\bclient[_-]?secret\b|\b(?:api|secret|private|encryption)[_-]?key\b/i;

/**
 * Bare credential words, for the places where any of them is already a finding: a state store and a
 * file that imports plain storage (`token: null`, `setItem('jwt', ...)`). Word boundaries keep
 * `pushToken`, `TokenSet` and design `tokens` out.
 */
export const BARE_CREDENTIAL_PATTERN = /\b(?:token|jwt|credentials?)\b/i;

/** What a log line must never carry: a credential, the Authorization header or a bearer value, a PKCE verifier or a raw nonce. */
export const LEAK_PATTERN = new RegExp(`${TOKEN_PATTERN.source}|\\bAuthorization\\b|\\bBearer\\b|\\bcode[_-]?verifier\\b|\\brawNonce\\b`, 'i');

/**
 * Identifiers (never words inside a message string) that hold a credential or a whole token answer:
 * `console.log(token)`, `console.warn('signed in', grant)`. Read on the masked view of a log call.
 */
export const LOGGED_VALUE_PATTERN = /\b(?:token|tokens|jwt|grant|credentials?)\b/;

export function loadSources(root, rels) {
  const sources = [];
  for (const rel of rels) {
    const text = readFileSync(join(root, rel), 'utf8');
    sources.push({ rel, text, code: maskComments(text), masked: maskCode(text), isTest: isTestFile(rel) });
  }
  return sources;
}

/** Import declarations (and require calls) of `pkg` or one of its subpaths: [{ index }]. */
export function importsOfPackage(src, pkg, { exact = false } = {}) {
  const hits = [];
  const matches = (from) => from === pkg || (!exact && from.startsWith(`${pkg}/`));
  for (const entry of findImports(src.text, src.masked)) if (matches(entry.from)) hits.push({ index: entry.index });
  for (const match of src.code.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    if (matches(match[2]) && src.masked.slice(match.index, match.index + 7) === 'require') hits.push({ index: match.index });
  }
  return hits;
}

export function importsAny(src, packages, options) {
  return packages.some((pkg) => importsOfPackage(src, pkg, options).length > 0);
}

/** Calls whose callee (a RegExp source, an optional `obj.` prefix allowed) matches: [{ name, start, open, close }]. */
export function callsOf(src, callee) {
  const out = [];
  const re = new RegExp(`(?<![\\w$])(?:[A-Za-z_$][\\w$]*\\.)*(${callee})\\s*\\(`, 'g');
  for (const match of src.masked.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(src.masked, open);
    if (close !== -1) out.push({ name: match[1], start: match.index, open, close });
  }
  return out;
}

/** The argument text of a call, comments blanked and strings kept. */
export function argText(src, call) {
  return src.code.slice(call.open + 1, call.close);
}

/** How many top-level arguments a call has (a trailing comma does not count). */
export function argCount(src, call) {
  const inner = src.masked.slice(call.open + 1, call.close);
  if (inner.trim() === '') return 0;
  let depth = 0;
  let count = 1;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0 && inner.slice(i + 1).trim() !== '') count += 1;
  }
  return count;
}

export function lineAt(src, index) {
  return lineOf(src.text, index);
}

/** The first match of `pattern` in a view of the file, as { index, line }, or null. */
export function firstMatch(src, pattern, view = 'code') {
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const match = re.exec(src[view]);
  return match ? { index: match.index, line: lineAt(src, match.index) } : null;
}

/** kebab-case step name to the factory that makes it: 'query-cache' -> 'queryCacheStep'. */
export function stepFactoryName(name) {
  return `${name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase())}Step`;
}

/** The app config file and its comment-masked text, or null. */
export function readAppConfig(root) {
  for (const name of ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.json']) {
    const abs = join(root, name);
    if (existsSync(abs)) {
      const text = readFileSync(abs, 'utf8');
      return { rel: name, text, code: name.endsWith('.json') ? text : maskComments(text) };
    }
  }
  return null;
}

/** 1-based line of the first occurrence of `needle` in `text`, or 1. */
export function lineOfText(text, needle) {
  const index = text.indexOf(needle);
  return index === -1 ? 1 : lineOf(text, index);
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
