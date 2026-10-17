// ts-scan.mjs: small, comment- and string-aware scans of TypeScript source for the checker.
// Not an entry point.

import { lineOf, maskComments } from '../check-lib.mjs';

/** Comments blanked (line numbers kept). */
export function code(source) {
  return maskComments(source);
}

/** Comments AND the contents of string and template literals blanked, for syntax scans. */
export function bare(source) {
  const masked = maskComments(source);
  let out = '';
  let i = 0;
  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < masked.length && masked[j] !== ch) {
        if (masked[j] === '\\') j += 1;
        else if (ch !== '`' && masked[j] === '\n') break;
        j += 1;
      }
      out += ch + masked.slice(i + 1, j).replace(/[^\n]/g, ' ') + (masked[j] ?? '');
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Every import or re-export specifier with its line: [{ specifier, line, isType }]. */
export function importsOf(source) {
  const text = code(source);
  const found = [];
  const patterns = [
    /^[ \t]*import\s+(type\s+)?[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm,
    /^[ \t]*export\s+(type\s+)?[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm,
    /^[ \t]*import\s+['"]([^'"]+)['"]/gm,
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const specifier = index === 2 ? match[1] : match[2];
      found.push({ specifier, line: lineOf(text, match.index), isType: index !== 2 && Boolean(match[1]) });
    }
  }
  return found;
}

/** Names a module exports (declarations and export lists). */
export function exportNames(source) {
  const text = code(source);
  const names = new Set();
  for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|type|interface|class)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Every match of `regex` (global) in `text` with its 1-based line. */
export function matchesWithLines(text, regex) {
  return [...text.matchAll(regex)].map((match) => ({ match, line: lineOf(text, match.index) }));
}

/** The text of `export type <name> = ...;` (to the first semicolon at bracket depth 0), or null. */
export function typeBlock(source, name) {
  const text = code(source);
  const start = new RegExp(`export\\s+type\\s+${name}\\s*(<[^=]*>)?\\s*=`).exec(text);
  if (start === null) return null;
  let depth = 0;
  for (let i = start.index + start[0].length; i < text.length; i += 1) {
    const ch = text[i];
    if ('{(['.includes(ch)) depth += 1;
    else if ('})]'.includes(ch)) depth -= 1;
    else if (ch === ';' && depth <= 0) return { text: text.slice(start.index, i + 1), line: lineOf(text, start.index) };
  }
  return { text: text.slice(start.index), line: lineOf(text, start.index) };
}
