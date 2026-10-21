// eslint-stricter.mjs: decides whether an extra eslint.config.mjs block only adds bans. Such a block
// sits directly after a canonical block, reaches only files that block reaches, and sets only
// no-restricted-* rules that block sets, each to the canonical value plus more entries; ESLint then
// applies the longer list to those files and nothing else changes. Owned by typescript-and-lint-rules
// (not synced); check-configs.mjs uses it.

import { within } from './eslint-lifts.mjs';

/** Keys of an object argument that only add bans when present (restrictedImports' paths and patterns). */
const BAN_KEYS = new Set(['paths', 'patterns']);
const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Splits normalized code at the commas of depth 0, skipping strings. */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i += 1; i < text.length && text[i] !== c; i += text[i] === '\\' ? 2 : 1);
    } else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (text.slice(start) !== '') parts.push(text.slice(start));
  return parts;
}

/** The shape of a normalized value: an array, an object, a call or an atom. */
function shapeOf(text) {
  if (text.startsWith('[') && text.endsWith(']')) return { kind: 'array', items: splitTop(text.slice(1, -1)) };
  if (text.startsWith('{') && text.endsWith('}')) {
    const entries = new Map();
    for (const part of splitTop(text.slice(1, -1))) {
      const key = /^(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*)):/.exec(part);
      if (key === null) return { kind: 'atom', text };
      entries.set(key[2] ?? key[3], part.slice(key[0].length));
    }
    return { kind: 'object', entries };
  }
  const call = /^([A-Za-z_$][\w$.]*)\((.*)\)$/.exec(text);
  if (call !== null) return { kind: 'call', callee: call[1], args: splitTop(call[2]) };
  return { kind: 'atom', text };
}

/** True when `added` is `base` with only more entries: a longer list, a list that spreads base first, more ban keys. */
export function addsOnly(base, added) {
  if (base === added) return true;
  const want = shapeOf(base);
  const got = shapeOf(added);
  if (want.kind === 'atom' && IDENT.test(base)) return got.kind === 'array' && got.items[0] === `...${base}`;
  if (want.kind !== got.kind) return false;
  if (want.kind === 'array') return got.items.length >= want.items.length && want.items.every((item, index) => got.items[index] === item);
  if (want.kind === 'call') return want.callee === got.callee && want.args.length === got.args.length && want.args.every((arg, index) => addsOnly(arg, got.args[index]));
  if (want.kind === 'object') {
    for (const [key, value] of want.entries) if (!got.entries.has(key) || !addsOnly(value, got.entries.get(key))) return false;
    return [...got.entries.keys()].every((key) => want.entries.has(key) || BAN_KEYS.has(key));
  }
  return false;
}

/**
 * Reviews an extra block against the block right before it in the app's config. Returns null when the
 * block is no candidate (the previous item is not a canonical block, or it sets a rule other than
 * no-restricted-*), otherwise { reasons } where an empty list means it only adds bans.
 */
export function reviewStricter(block, previous, { label }) {
  if (previous === null || previous.kind !== 'block' || block.rules.size === 0) return null;
  if ([...block.rules.keys()].some((rule) => !rule.startsWith('no-restricted-'))) return null;
  const reasons = [];
  if (block.keys.size > 0 || block.ignores !== null || block.files === null || block.files.unresolved.length > 0) reasons.push('holds more than files and rules');
  const covered = previous.files === null ? null : previous.files.units.flatMap((unit) => unit.globs);
  const globs = block.files === null ? [] : block.files.units.flatMap((unit) => unit.globs);
  const outside = covered === null ? [] : globs.filter((glob) => !covered.some((allow) => within(glob, allow)));
  if (outside.length > 0) reasons.push(`reaches files the block before it (${label(previous)}) does not cover (${outside.join(', ')})`);
  for (const [rule, value] of block.rules) {
    const base = previous.rules.get(rule);
    if (base === undefined) reasons.push(`sets ${rule}, which the block before it (${label(previous)}) does not set`);
    else if (typeof base !== 'string' || typeof value !== 'string' || !addsOnly(base, value)) reasons.push(`does not keep every entry of the block before it for ${rule}`);
  }
  return { reasons };
}
