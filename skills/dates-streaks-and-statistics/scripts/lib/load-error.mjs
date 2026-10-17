// load-error.mjs: turns a failed import of an app module into one line that names the real cause
// (a helper, not an entry point). Node reports an unresolved alias such as '@/core/dates/date-key'
// as "Cannot find package '@/core'", which reads like an npm package; this helper finds the full
// specifier in the importing file, maps it through the tsconfig aliases and says which repo file is
// missing (and which skill creates it), keeping "not pure TypeScript" for real packages.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import { resolveAlias } from '../check-lib.mjs';
import { errorText } from './app-modules.mjs';

/** Repo files other skills create, by repo-relative path without the extension. */
const OWNERS = {
  'core/dates/date-key': 'seeded-determinism-and-golden-vectors',
  'services/clock/clock-port': 'architecture-and-boundaries',
};

const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.json', '/index.ts', '/index.tsx'];

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const toPosix = (path) => path.split(sep).join('/');

/** True when a repo-relative path (with or without an extension) names an existing file. */
function exists(root, rel) {
  return EXTENSIONS.some((ext) => isFile(join(root, `${rel}${ext}`)));
}

/** The skill that creates a missing repo file, or null when it is this skill's or the app's own. */
function ownerOf(rel, srcDir) {
  const inSrc = rel.startsWith(`${srcDir}/`) ? rel.slice(srcDir.length + 1) : rel;
  return OWNERS[inSrc.replace(/\.(m?ts|tsx)$/, '')] ?? null;
}

const missingFile = (rel, srcDir) => {
  const owner = ownerOf(rel, srcDir);
  return `which does not exist${owner === null ? '' : ` (${owner} creates it)`}`;
};

/** The specifiers a source file imports or re-exports. */
function specifiersOf(source) {
  return [...source.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

/**
 * One line for a failed import, without absolute paths.
 * root: the repo root; layout: resolveLayout(root) (srcDir and aliases are read).
 */
export function describeLoadError(error, root, layout) {
  const text = errorText(error);
  const missing = /Cannot find (package|module) '([^']+)'(?: imported from (\S+))?/.exec(text);
  if (missing === null) return text.replace(/ imported from \S+/, '');
  const [, kind, name, importer] = missing;
  const srcDir = layout.srcDir ?? 'src';
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  if (kind === 'module' && name.startsWith('/')) {
    const rel = toPosix(relative(realRoot, name));
    if (!rel.startsWith('..')) return `it imports ${rel}, ${missingFile(rel, srcDir)}`;
  }
  if (importer !== undefined && isFile(importer)) {
    const wanted = specifiersOf(readFileSync(importer, 'utf8')).filter((spec) => spec === name || spec.startsWith(`${name}/`));
    for (const spec of wanted) {
      const targets = resolveAlias(spec, layout.aliases);
      if (targets === null || targets.length === 0) continue;
      if (targets.some((target) => exists(root, posix.normalize(target)))) continue;
      const rel = posix.normalize(targets[0]);
      return `it imports ${spec} (${rel}), ${missingFile(rel, srcDir)}`;
    }
  }
  return `it imports ${name}, which plain Node cannot load (the module is not pure TypeScript)`;
}

/** The fix for a module-load problem: create the missing file, or keep the module pure. */
export function loadFix(message, pureFix) {
  if (!message.includes('which does not exist')) return pureFix;
  return 'Create the missing file (copy it from this skill\'s templates/, or apply the skill named in the message), or fix the import path.';
}
