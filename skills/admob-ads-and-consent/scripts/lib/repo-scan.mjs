// repo-scan.mjs: reading an app repo for this skill's checkers. File lists come from check-lib's
// walkRepo (it prunes installed skills, agent folders and build output), paths from resolveLayout.
// Not an entry point.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments, readWorkspaces, walkRepo } from '../check-lib.mjs';

const SOURCE = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'];
const APP_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];

/** Every source file of the app code under srcDir (repo-relative, posix). */
export function runtimeSourceFiles(root, layout) {
  const prefix = `${layout.srcDir}/`;
  return walkRepo(root, { include: SOURCE }).filter((rel) => rel.startsWith(prefix) && !rel.endsWith('.d.ts'));
}

/** The files that build the native config: the app config, src/config and local config plugins. */
export function configFiles(root, layout) {
  const files = APP_CONFIGS.filter((rel) => existsSync(join(root, rel)));
  for (const rel of walkRepo(root, { include: SOURCE })) {
    if (rel.startsWith(`${layout.configDir}/`) || rel.startsWith('plugins/')) files.push(rel);
  }
  return [...new Set(files)];
}

/** package.json of the root and of every workspace (repo-relative). */
export function packageJsonFiles(root) {
  const files = existsSync(join(root, 'package.json')) ? ['package.json'] : [];
  for (const workspace of readWorkspaces(root)) files.push(`${workspace.dir}/package.json`);
  return files;
}

export function readRepoText(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

export function readRepoJson(root, rel) {
  try {
    return JSON.parse(readRepoText(root, rel));
  } catch {
    return null;
  }
}

/** Tests, test helpers and root mocks: allowed to name what app code may not. */
export function isTestFile(rel) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)(__tests__|__mocks__)\//.test(rel) || rel.startsWith('test/');
}

/** 1-based line of a character index. */
export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Static imports, re-exports and requires of a module source (comments masked first).
 * Returns [{ specifier, names: string[] ('default' for a default import), isType, line }].
 */
export function parseImports(source) {
  const text = maskComments(source);
  const out = [];
  const importRe = /\bimport\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(importRe)) {
    const clause = match[2].trim();
    const names = [];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }
    const beforeBraces = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    if (beforeBraces && !beforeBraces.startsWith('*')) names.push('default');
    if (beforeBraces.startsWith('*')) names.push('*');
    out.push({ specifier: match[3], names, isType: Boolean(match[1]), line: lineAt(text, match.index) });
  }
  for (const match of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push({ specifier: match[1], names: [], isType: false, line: lineAt(text, match.index) });
  for (const match of text.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ specifier: match[1], names: [], isType: false, line: lineAt(text, match.index) });
  for (const match of text.matchAll(/\bexport\s+(type\s+)?(?:\{[^}]*\}|\*)\s*from\s*['"]([^'"]+)['"]/g)) out.push({ specifier: match[2], names: [], isType: Boolean(match[1]), line: lineAt(text, match.index) });
  return out;
}

/** Index of the parenthesis that closes the one at openIndex (text should have comments masked). */
export function matchingParen(text, openIndex) {
  return matchingBracket(text, openIndex, '(', ')');
}

/** Index of the bracket that closes the one at openIndex (`(`/`)` or `{`/`}`), skipping strings. */
export function matchingBracket(text, openIndex, open, close) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Ranges [start, end] of the argument lists of every call to one of the named functions. */
export function callRanges(text, names) {
  const ranges = [];
  const re = new RegExp(`\\b(${names.join('|')})\\s*\\(`, 'g');
  for (const match of text.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const close = matchingParen(text, open);
    if (close !== -1) ranges.push({ name: match[1], start: open, end: close });
  }
  return ranges;
}

/** True when an import specifier names the module file `base` (with or without its extension). */
export function importsModule(specifier, base) {
  const stem = base.replace(/\.(ts|tsx)$/, '');
  return specifier.endsWith(`/${stem}`) || specifier.endsWith(`/${base}`) || specifier === `./${stem}` || specifier === `./${base}`;
}

/**
 * Same-file functions whose body matches `bodyPattern`: `function name(...) {...}` and
 * `const name = (async) (...) => {...}` / `= function (...) {...}`. Returns their names (one step
 * only: a helper that calls such a helper is not followed).
 */
export function localFunctionsMatching(text, bodyPattern) {
  const names = [];
  const re = /\b(?:function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b[^(]*)?\()/g;
  for (const match of text.matchAll(re)) {
    const name = match[1] ?? match[2];
    const paramsClose = matchingParen(text, match.index + match[0].length - 1);
    if (paramsClose === -1) continue;
    const brace = text.indexOf('{', paramsClose);
    const between = text.slice(paramsClose + 1, brace);
    if (brace === -1 || !/^\s*(?::[^{]*)?(?:=>)?\s*$/.test(between)) continue;
    const end = matchingBracket(text, brace, '{', '}');
    if (end !== -1 && bodyPattern.test(text.slice(brace, end))) names.push(name);
  }
  return names;
}
