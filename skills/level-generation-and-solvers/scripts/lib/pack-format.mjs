// pack-format.mjs: the exact bytes of a pack-<n>.json. generate-levels.ts writes every pack through
// the repo's own Prettier (its config, the json parser), so `prettier --check` and the generator
// agree; the checker compares bytes the same way. Not an entry point.
//
// When the repo has no Prettier installed (the self-test's throwaway repos), packStyle() writes the
// same bytes by Prettier's JSON rules for level tables: objects stay expanded (the generator's
// source has a line break after every "{"), an array of plain values goes on one line when it
// fits the print width (score thresholds: [0, 150, 180]), a longer array of numbers is filled line
// by line, anything else is one element per line, and a newline ends the file.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULTS = { printWidth: 80, tabWidth: 2, useTabs: false };

/** printWidth, tabWidth and useTabs from .prettierrc(.json) or package.json "prettier" (JSON only). */
function readPlainConfig(root) {
  for (const name of ['.prettierrc', '.prettierrc.json']) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    try {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch {
      return DEFAULTS;
    }
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return typeof pkg.prettier === 'object' && pkg.prettier !== null ? { ...DEFAULTS, ...pkg.prettier } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const isPlain = (value) => value === null || typeof value !== 'object';

/** A plain value as Prettier prints it (it drops the "+" of an exponent: 3e+21 -> 3e21). */
const literal = (value) => (typeof value === 'number' ? JSON.stringify(value).replace('e+', 'e') : JSON.stringify(value));

/** The one-line form of a value, or null when it holds a non-empty object (always expanded). */
function flat(node) {
  if (isPlain(node)) return literal(node);
  if (Array.isArray(node)) {
    const parts = node.map(flat);
    return parts.includes(null) ? null : `[${parts.join(', ')}]`;
  }
  return Object.keys(node).length === 0 ? '{}' : null;
}

/** Prettier breaks a matrix: two or more elements that are all arrays of two or more. */
const isMatrix = (node) => node.length > 1 && node.every((item) => Array.isArray(item) && item.length > 1);

function fillNumbers(items, pad, width) {
  const lines = [];
  let line = '';
  items.forEach((item, index) => {
    const text = `${literal(item)}${index < items.length - 1 ? ',' : ''}`;
    if (line === '') line = text;
    else if (pad.length + line.length + 1 + text.length <= width) line = `${line} ${text}`;
    else {
      lines.push(line);
      line = text;
    }
  });
  lines.push(line);
  return lines;
}

/** Prettier's JSON output for a value made by JSON.stringify(value, null, 2) (see the header). */
export function packStyle(value, config = DEFAULTS) {
  const unit = config.useTabs ? '\t' : ' '.repeat(config.tabWidth);
  // prefix: the characters before the value on its line; suffix: the comma after it, if any.
  const print = (node, depth, prefixLength, suffixLength) => {
    const pad = unit.repeat(depth);
    const inner = unit.repeat(depth + 1);
    if (isPlain(node)) return literal(node);
    if (Array.isArray(node)) {
      if (node.length === 0) return '[]';
      const inline = isMatrix(node) ? null : flat(node);
      if (inline !== null && prefixLength + inline.length + suffixLength <= config.printWidth) return inline;
      if (node.length > 1 && node.every((item) => typeof item === 'number')) {
        return `[\n${fillNumbers(node, inner, config.printWidth).map((line) => `${inner}${line}`).join('\n')}\n${pad}]`;
      }
      const last = node.length - 1;
      return `[\n${node.map((item, index) => `${inner}${print(item, depth + 1, inner.length, index < last ? 1 : 0)}`).join(',\n')}\n${pad}]`;
    }
    const keys = Object.keys(node);
    if (keys.length === 0) return '{}';
    const last = keys.length - 1;
    return `{\n${keys.map((key, index) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      return `${head}${print(node[key], depth + 1, head.length, index < last ? 1 : 0)}`;
    }).join(',\n')}\n${pad}}`;
  };
  return `${print(value, 0, 0, 0)}\n`;
}

/**
 * The formatter the checker compares packs with: the repo's Prettier when it is installed (the
 * generator's own call), else packStyle with the repo's plain JSON config. format(rel, value).
 */
export async function createPackFormatter(root) {
  const absRoot = resolve(root);
  let prettier = null;
  try {
    const entry = createRequire(join(absRoot, 'package.json')).resolve('prettier');
    const loaded = await import(pathToFileURL(entry).href);
    prettier = typeof loaded.format === 'function' ? loaded : loaded.default;
  } catch {
    prettier = null;
  }
  if (prettier && typeof prettier.format === 'function') {
    return {
      source: 'the repo\'s Prettier',
      format: async (rel, value) => {
        const config = (await prettier.resolveConfig(join(absRoot, rel))) ?? {};
        return prettier.format(JSON.stringify(value, null, 2), { ...config, parser: 'json' });
      },
    };
  }
  const config = readPlainConfig(absRoot);
  return { source: 'Prettier\'s JSON style (Prettier is not installed)', format: async (_rel, value) => packStyle(value, config) };
}
