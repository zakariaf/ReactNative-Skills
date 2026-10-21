// eslint-lifts.mjs: decides whether an extra eslint.config.mjs block that lifts a banned package
// (restrictedImports({ allow: [...] })) is the sanctioned lift for a scoped doNotAdd entry of
// contracts/dependency-policy.json: the files its allowIn names may import the package, nothing else
// changes for them. Owned by typescript-and-lint-rules (not synced); check-configs.mjs uses it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { matchGlob, parseJsonc } from '../check-lib.mjs';

const IDENT = /^[A-Za-z_$][\w$]*$/;
const GLOB_CHARS = /[*?[\]{}()!]/;
const IMPORTS_RULE = 'no-restricted-imports';

/** Strips the first workspace prefix ('apps/<star>/') from a glob, as the config model does. */
function stripPrefix(glob, prefixes) {
  for (const prefix of prefixes) if (glob.startsWith(prefix)) return glob.slice(prefix.length);
  return glob;
}

/**
 * The scoped doNotAdd entries of the dependency policy: Map(package -> allowIn globs, or null when
 * the entry names none). A missing or unreadable policy has none.
 */
export function scopedEntries(root, contractsDir, prefixes = []) {
  const file = join(root, contractsDir, 'dependency-policy.json');
  const entries = new Map();
  if (!existsSync(file)) return entries;
  let policy;
  try {
    policy = parseJsonc(readFileSync(file, 'utf8'));
  } catch {
    return entries;
  }
  for (const [name, entry] of Object.entries(policy?.doNotAdd ?? {})) {
    if (typeof entry !== 'object' || entry === null) continue;
    const allowIn = Array.isArray(entry.allowIn) ? entry.allowIn.filter((glob) => typeof glob === 'string' && glob !== '').map((glob) => stripPrefix(glob, prefixes)) : [];
    entries.set(name, allowIn.length > 0 ? allowIn : null);
  }
  return entries;
}

/** A path the glob matches: '**' and '*' become a segment, a brace takes its first branch, a folder glob gets a file. */
export function sampleOf(glob) {
  const path = glob.replace(/\{([^,}]*)[^}]*\}/g, '$1').replaceAll('**', 'sample').replaceAll('*', 'sample');
  return /\.[A-Za-z]+$/.test(path.split('/').pop()) ? path : `${path}/sample.ts`;
}

/** The literal folders a glob starts with ('test/rules/' for 'test/rules/**'). */
function staticDir(glob) {
  const fixed = [];
  for (const segment of glob.split('/').slice(0, -1)) {
    if (GLOB_CHARS.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.length === 0 ? '' : `${fixed.join('/')}/`;
}

/** True when every file `glob` reaches lies under `allow` (an exact file it matches, or a narrower glob under its folders). */
export function within(glob, allow) {
  if (glob === allow) return true;
  return matchGlob(sampleOf(glob), allow) && staticDir(glob).startsWith(staticDir(allow));
}

/** The value of the last canonical block that sets no-restricted-imports for `path`, its const resolved. */
function canonicalImportsFor(canonical, path) {
  let value = null;
  for (const block of canonical.items) {
    if (block.kind !== 'block' || !block.rules.has(IMPORTS_RULE)) continue;
    const hit = (scope) => scope.units.some((unit) => unit.globs.some((glob) => matchGlob(path, glob)));
    if (block.files !== null && !hit(block.files)) continue;
    if (block.ignores !== null && hit(block.ignores)) continue;
    value = block.rules.get(IMPORTS_RULE);
  }
  if (value !== null && IDENT.test(value) && canonical.consts.has(value)) return canonical.consts.get(value).text;
  return value;
}

/** The names in a normalized restrictedImports({ ..., allow: [A, B] }) call, and the call without them. */
function splitAllow(value) {
  const match = /^restrictedImports\(\{(.*)\}\)$/.exec(value ?? '');
  if (match === null) return null;
  const allow = /(?:^|,)allow:\[([^\]]*)\]/.exec(match[1]);
  if (allow === null) return null;
  const names = allow[1].split(',').filter(Boolean);
  const rest = match[1].replace(allow[0], '').replace(/^,/, '');
  return { names, rest: `restrictedImports({${rest}})` };
}

/** The package a banned-entry const names: banned('pkg', ...) or bannedWithSubpaths('pkg', ...). */
function packageOf(app, name) {
  const text = app.consts.get(name)?.text ?? '';
  return /^banned(?:WithSubpaths)?\((['"])([^'"]+)\1/.exec(text)?.[2] ?? null;
}

/**
 * Reviews one extra block. Returns null when it lifts nothing, otherwise { reasons: [text] } where an
 * empty list means it is a sanctioned lift: only no-restricted-imports, its value the canonical value
 * for those files plus an allow list, and every lifted package a scoped doNotAdd entry whose allowIn
 * covers each of the block's files.
 */
export function reviewLift(block, { app, canonical, scoped }) {
  const split = splitAllow(block.rules.get(IMPORTS_RULE));
  if (split === null) return null;
  const reasons = [];
  const globs = block.files === null ? ['**'] : block.files.units.flatMap((unit) => unit.globs);
  if (block.files === null || block.files.unresolved.length > 0) reasons.push('names no files the checker can resolve');
  const otherRules = [...block.rules.keys()].filter((rule) => rule !== IMPORTS_RULE);
  const otherKeys = [...block.keys.keys()];
  if (otherRules.length > 0 || otherKeys.length > 0 || block.ignores !== null) reasons.push(`sets more than no-restricted-imports (${[...otherRules, ...otherKeys, ...(block.ignores ? ['ignores'] : [])].join(', ')})`);
  for (const name of split.names) {
    const pkg = packageOf(app, name);
    const allowIn = pkg === null ? undefined : scoped.get(pkg);
    if (allowIn === undefined) reasons.push(`lifts ${name}, which no scoped doNotAdd entry with allowIn names`);
    else if (allowIn === null) reasons.push(`lifts ${pkg}, whose doNotAdd entry names no allowIn`);
    else {
      for (const glob of globs.filter((value) => !allowIn.some((allow) => within(value, allow)))) {
        reasons.push(`lifts ${pkg} for ${glob}, which its doNotAdd entry's allowIn (${allowIn.join(', ')}) does not cover`);
      }
    }
  }
  const wanted = [...new Set(globs.map((glob) => canonicalImportsFor(canonical, sampleOf(glob))))];
  if (wanted.length !== 1 || wanted[0] !== split.rest) {
    reasons.push(`does not keep the canonical no-restricted-imports of those files beside its allow list (${wanted.filter(Boolean).join(' / ') || 'none'})`);
  }
  return { reasons };
}
