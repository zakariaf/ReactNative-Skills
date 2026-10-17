// app-modules.mjs: import the app's pure TypeScript modules straight from a repo root, so a checker
// can run the real reducers, rules and formatters (a helper, not an entry point).
//
// Node strips TypeScript types itself (Node 22.18+). module.registerHooks() adds two hooks:
//   resolve  inside an enabled root: tsconfig "paths" aliases (@/* -> src/*, with "extends"),
//            workspace package names (@acme/core/x -> packages/core/x or packages/core/src/x) and
//            relative imports written without an extension, probed the way Metro and TypeScript
//            look files up (.ts, .tsx, .js, ..., .ios/.android/.native variants, index files)
//   load     .ts / .mts files under the root load as TypeScript ES modules, .json files as a
//            default export, so the check works with or without package.json "type"
// Only modules whose imports are pure (types, other pure modules) load this way: a module that
// imports React Native, Expo or Skia fails to load, which is exactly the purity those rules need.
// .tsx files cannot load (type stripping does not transform JSX).
//
//   const app = enableAppImports(root);              // several roots may be enabled in one process
//   if (app.exists('src/features/tasks/tasks-reducer.ts')) {
//     const { tasksReducer } = await app.load('src/features/tasks/tasks-reducer.ts');
//   }
// Also: deepFreeze(value), lineOfExport(source, name), reasonOf(error), errorText(error).
//
// Changed from the older copies: no fixed package scope; aliases come from tsconfig.json and package
// names from package.json "workspaces". enableAppImports(root, { aliases }) may pass aliases.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fail, readTsconfigPaths, readWorkspaces, resolveAlias, toPosix } from '../check-lib.mjs';

const EXTENSIONS = ['.ts', '.mts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json'];
const PLATFORMS = ['native', 'ios', 'android'];

/** Every enabled root: { url (the real path, ending in '/'), abs (the real path), aliases, packages: [{ name, dir, main }] }. */
const roots = [];
let hooksRegistered = false;

const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** The first existing file for a repo-relative path written with or without an extension, or null. */
function probe(absRoot, rel) {
  const base = posix.normalize(rel);
  const candidates = [base];
  const js = /\.(m|c)?jsx?$/.exec(base);
  if (js) candidates.push(`${base.slice(0, -js[0].length)}${js[0].replace('js', 'ts')}`);
  for (const ext of EXTENSIONS) {
    candidates.push(`${base}${ext}`);
    for (const platform of PLATFORMS) candidates.push(`${base}.${platform}${ext}`);
  }
  for (const ext of EXTENSIONS) candidates.push(`${base}/index${ext}`);
  for (const candidate of candidates) if (!candidate.startsWith('..') && isFile(join(absRoot, candidate))) return candidate;
  return null;
}

/** The root a module URL lives in (the newest root when the importer is outside all of them). */
function rootOf(url) {
  return roots.find((root) => typeof url === 'string' && url.startsWith(root.url)) ?? roots.at(-1);
}

/** A workspace package import (@acme/core or @acme/core/money) -> a repo-relative file, or null. */
function packageTarget(root, specifier) {
  for (const pkg of root.packages) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) continue;
    const sub = specifier.slice(pkg.name.length + 1);
    if (sub === '') return probe(root.abs, posix.join(pkg.dir, pkg.main)) ?? probe(root.abs, posix.join(pkg.dir, 'src', 'index')) ?? probe(root.abs, posix.join(pkg.dir, 'index'));
    return probe(root.abs, posix.join(pkg.dir, sub)) ?? probe(root.abs, posix.join(pkg.dir, 'src', sub));
  }
  return null;
}

function registerOnce() {
  if (hooksRegistered) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL;
      const root = roots.length > 0 ? rootOf(parent) : null;
      const inside = root !== null && typeof parent === 'string' && parent.startsWith(root.url);
      if (root === null) return nextResolve(specifier, context);
      if (inside && (specifier.startsWith('./') || specifier.startsWith('../'))) {
        const fromRel = toPosix(fileURLToPath(parent)).slice(toPosix(root.abs).length + 1);
        const found = probe(root.abs, posix.join(posix.dirname(fromRel), specifier));
        if (found !== null) return nextResolve(pathToFileURL(join(root.abs, found)).href, context);
        return nextResolve(specifier, context);
      }
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || /^[a-z]+:/i.test(specifier)) return nextResolve(specifier, context);
      const mapped = resolveAlias(specifier, root.aliases);
      if (mapped !== null) {
        for (const candidate of mapped) {
          const found = probe(root.abs, candidate);
          if (found !== null) return nextResolve(pathToFileURL(join(root.abs, found)).href, context);
        }
      }
      const fromPackage = packageTarget(root, specifier);
      if (fromPackage !== null) return nextResolve(pathToFileURL(join(root.abs, fromPackage)).href, context);
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (!roots.some((root) => url.startsWith(root.url)) || url.includes('/node_modules/')) return nextLoad(url, context);
      if (url.endsWith('.ts') || url.endsWith('.mts')) return nextLoad(url, { ...context, format: 'module-typescript' });
      if (url.endsWith('.json')) {
        const text = readFileSync(fileURLToPath(url), 'utf8');
        return { format: 'module', source: `export default ${text};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  hooksRegistered = true;
}

/**
 * Lets this process import the repo's TypeScript from `root`. Several roots may be enabled (a
 * self-test builds more than one repo); aliases resolve inside the root of the importing file.
 * options.aliases: tsconfig aliases to use instead of reading <root>/tsconfig.json.
 * Returns { root, exists(rel), load(rel) } where load() imports a repo-relative module.
 */
export function enableAppImports(root, { aliases } = {}) {
  if (typeof registerHooks !== 'function' || !process.features?.typescript) {
    fail('this Node cannot load TypeScript modules (module.registerHooks and type stripping are needed)', 'Use Node 22.18 or newer.');
  }
  const given = resolve(root);
  // Module URLs are real paths (a temp folder under /var is /private/var on macOS).
  const abs = existsSync(given) ? realpathSync(given) : given;
  const url = pathToFileURL(`${abs}/`).href;
  if (!roots.some((entry) => entry.url === url)) {
    const packages = readWorkspaces(abs)
      .filter((entry) => entry.name)
      .map((entry) => ({ name: entry.name, dir: entry.dir, main: typeof entry.manifest?.main === 'string' ? entry.manifest.main.replace(/^\.\//, '') : 'index' }))
      .sort((a, b) => b.name.length - a.name.length);
    roots.push({ url, abs, aliases: aliases ?? readTsconfigPaths(abs)?.aliases ?? [], packages });
  }
  registerOnce();
  return {
    root: given,
    exists: (rel) => existsSync(join(abs, rel)),
    load: (rel) => import(pathToFileURL(join(abs, rel)).href),
  };
}

/** Deep-freezes a value so a reducer that mutates its input throws in strict mode. */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** 1-based line of the first "function <name>" or "const <name>" in a source text, else 1. */
export function lineOfExport(source, name) {
  const match = new RegExp(`(function\\s+${name}\\b|const\\s+${name}\\b)`).exec(source ?? '');
  if (!match) return 1;
  return source.slice(0, match.index).split('\n').length;
}

const shortJson = (value) => {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** One-line reason for a failed check; Node's generated assert messages become "expected X, got Y". */
export function reasonOf(error) {
  const first = String(error?.message ?? error).split('\n')[0];
  if (error?.generatedMessage !== true || !('actual' in error)) return first;
  return `expected ${shortJson(error.expected)}, got ${shortJson(error.actual)}`;
}

/** One line for a load or run error: the message, without the stack. */
export function errorText(error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.split('\n')[0];
}
