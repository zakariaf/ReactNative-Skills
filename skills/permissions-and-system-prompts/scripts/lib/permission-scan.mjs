// permission-scan.mjs: finds where app code reads or requests a permission, and the code shapes the
// rules of check-permissions.mjs look at (effects, module scope, local imports). A helper, not an
// entry point. Every function works on one source file's text and its masked copy (source-scan's
// maskCode: comments and literal contents blanked, positions kept).
//
//   loadApiTable(skillDir)              assets/permission-apis.json, parsed
//   importBindings(source, masked)      [{ module, local, imported, form, index, end }] for value imports
//   permissionUses(file, table)         [{ index, line, module, fn, kind, op }] op: read | request | hook
//   effectSpans(masked)                 [[start, end]] of the callbacks of useEffect & co
//   braceDepthAt(masked, index)         how many { } blocks enclose an index (0 = module scope)
//   localImportTexts(file, ctx)         the texts of the repo files a file imports (relative or alias)
//   jsonLineOf(text, needle, from)      1-based line of the first occurrence of a JSON string

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findClosing, makeLineOf, resolveImport } from './source-scan.mjs';

export function loadApiTable(skillDir) {
  return JSON.parse(readFileSync(join(skillDir, 'assets', 'permission-apis.json'), 'utf8'));
}

const IMPORT = /(^|\n)[ \t]*import\s+(?!type\b)([^;]*?)\s+from\s*(['"])([^'"]+)\3/g;

/** Value bindings of every import statement (type-only names skipped). */
export function importBindings(source, masked) {
  const found = [];
  for (const match of source.matchAll(IMPORT)) {
    const index = match.index + match[1].length;
    if (masked.slice(index, index + 6) !== 'import') continue; // inside a comment
    const end = match.index + match[0].length;
    const clause = match[2].trim();
    const module = match[4];
    const braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, '').split(',').map((part) => part.trim()).filter(Boolean);
    for (const part of outside) {
      const ns = /^\*\s+as\s+([\w$]+)$/.exec(part);
      if (ns) found.push({ module, local: ns[1], imported: '*', form: 'namespace', index, end });
      else if (/^[\w$]+$/.test(part)) found.push({ module, local: part, imported: 'default', form: 'default', index, end });
    }
    for (const raw of braces ? braces[1].split(',') : []) {
      const part = raw.trim();
      if (part === '' || part.startsWith('type ')) continue;
      const named = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(part);
      if (named) found.push({ module, local: named[2] ?? named[1], imported: named[1], form: 'named', index, end });
    }
  }
  return found;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every read, request or permission hook of a table module, and every PermissionsAndroid call. */
export function permissionUses(file, table) {
  const { source, masked } = file;
  const lineOf = makeLineOf(source);
  const uses = [];
  const add = (index, module, fn, kind, op) => uses.push({ index, line: lineOf(index), module, fn, kind, op });
  for (const binding of importBindings(source, masked)) {
    const entry = moduleEntry(table, binding.module);
    if (entry) collectModuleUses(binding, entry, masked, add);
    if (binding.module === 'react-native' && binding.imported === 'PermissionsAndroid') collectAndroidUses(binding, file, table, add);
  }
  return uses.sort((a, b) => a.index - b.index);
}

/** A table entry by package name, so subpaths (expo-media-library/legacy) resolve to their package. */
function moduleEntry(table, specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined;
  const parts = specifier.split('/');
  const pkg = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return Object.hasOwn(table.modules, pkg) ? table.modules[pkg] : undefined;
}

function collectModuleUses(binding, entry, masked, add) {
  const fn = binding.form === 'named' ? entry.functions[binding.imported] : undefined;
  if (fn) {
    // A named function: every occurrence after the import is a use, a call or a reference
    // (read: getCameraPermissionsAsync handed to an adapter factory).
    const re = new RegExp(`(?<![\\w$.])${escape(binding.local)}(?![\\w$])`, 'g');
    for (const match of masked.slice(binding.end).matchAll(re)) {
      const index = binding.end + match.index;
      add(index, binding.module, binding.imported, kindOf(entry, binding.imported, masked, index + match[0].length), fn[1]);
    }
    return;
  }
  // A namespace, a default import or a named object (Camera, Audio, Pedometer): ns.fn or ns.X.fn.
  const re = new RegExp(`(?<![\\w$.])${escape(binding.local)}\\s*(?:\\.\\s*[\\w$]+\\s*)?\\.\\s*([\\w$]+)`, 'g');
  for (const match of masked.slice(binding.end).matchAll(re)) {
    const name = match[1];
    const known = entry.functions[name];
    if (!known) continue;
    const index = binding.end + match.index;
    add(index, binding.module, name, kindOf(entry, name, masked, index + match[0].length), known[1]);
  }
}

/** expo-media-library's requestPermissionsAsync(true) asks for add-only access; `index` is just past the name. */
function kindOf(entry, fn, masked, index) {
  const kind = entry.functions[fn][0];
  if (!entry.writeOnlyKind) return kind;
  const after = masked.slice(index, index + 80);
  return /^\s*\(\s*true\b/.test(after) ? entry.writeOnlyKind : kind;
}

function collectAndroidUses(binding, file, table, add) {
  const { masked, commentless } = file;
  const re = new RegExp(`(?<![\\w$.])${escape(binding.local)}\\s*\\.\\s*(request|requestMultiple|check)\\s*\\(`, 'g');
  const names = new Set();
  for (const match of masked.matchAll(/PERMISSIONS\s*\.\s*([A-Z_]+)/g)) names.add(match[1]);
  for (const match of commentless.matchAll(/['"]android\.permission\.([A-Z_]+)['"]/g)) names.add(match[1]);
  const kinds = [...names].map((name) => table.androidPermissionKinds[name]).filter((kind) => typeof kind === 'string');
  for (const match of masked.slice(binding.end).matchAll(re)) {
    const index = binding.end + match.index;
    const op = match[1] === 'check' ? 'read' : 'request';
    for (const kind of kinds.length > 0 ? new Set(kinds) : ['unknown']) add(index, 'react-native', `PermissionsAndroid.${match[1]}`, kind, op);
  }
}

const EFFECTS = /(?<![\w$.])(?:React\s*\.\s*)?(useEffect|useLayoutEffect|useInsertionEffect|useFocusEffect)\s*\(/g;

/** The argument spans of every effect call: an ask inside one runs without a press. */
export function effectSpans(masked) {
  const spans = [];
  for (const match of masked.matchAll(EFFECTS)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open);
    if (close !== -1) spans.push([open, close, match[1]]);
  }
  return spans;
}

export function braceDepthAt(masked, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    const ch = masked[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** The texts of the repo files this file imports (relative paths and tsconfig aliases). */
export function localImportTexts(file, { root, aliases, readFile }) {
  const texts = [];
  for (const binding of importBindingsOrTypes(file.source)) {
    const resolved = resolveImport(file.rel, binding, { root, aliases });
    if (resolved?.kind === 'local' && resolved.exists && resolved.path) {
      const text = readFile(resolved.path);
      if (text !== null) texts.push(text);
    }
  }
  return texts;
}

function importBindingsOrTypes(source) {
  return [...source.matchAll(/(^|\n)[ \t]*import\s[^;]*?from\s*(['"])([^'"]+)\2/g)].map((match) => match[3]);
}

/** 1-based line of the first `"<needle>"` at or after `from` in a JSON text (1 when absent). */
export function jsonLineOf(text, needle, from = 0) {
  const at = text.indexOf(JSON.stringify(needle), from);
  if (at === -1) return 1;
  return text.slice(0, at).split('\n').length;
}
