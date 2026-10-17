// scripts/levels/app-imports.ts
// Lets a Node script import the app's pure TypeScript under src/ (a level plan, its solver and the
// game's rules). Node strips the types itself; these module hooks add what Metro and TypeScript do
// for the app: the @/ alias, imports written without an extension, .ts files loaded as TypeScript
// modules and .json files as a default export. A module that imports React Native or Expo does
// not load, which is the purity the level code needs anyway.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The extensions a written import may leave out, in the order the app's bundler tries them. */
export const APP_EXTENSIONS = ['.ts', '.tsx', '.js', '.json'] as const;

/** The paths an import of `base` may mean: as written, with an extension, then an index file. */
export function candidatePaths(base: string): string[] {
  return [
    base,
    ...APP_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...APP_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
}

/**
 * The absolute path (without probing) an app import points at, or null for a package: `@/x` is
 * `<srcDir>/x`, and a relative import from a file under srcDir is relative to that file.
 */
export function appImportBase(
  specifier: string,
  parentPath: string | null,
  srcDir: string,
): string | null {
  if (specifier.startsWith('@/')) return join(srcDir, specifier.slice(2));
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative || parentPath?.startsWith(`${srcDir}/`) !== true) return null;
  return join(dirname(parentPath), specifier);
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** Registers the hooks for the app at `rootDir`, its sources in `<rootDir>/<srcDirName>`. Call once. */
export function registerAppImports(rootDir: string, srcDirName = 'src'): void {
  const srcDir = resolve(rootDir, srcDirName);
  const srcUrl = pathToFileURL(`${srcDir}/`).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL;
      const parentPath = parent?.startsWith('file:') === true ? fileURLToPath(parent) : null;
      const base = appImportBase(specifier, parentPath, srcDir);
      const found = base === null ? undefined : candidatePaths(base).find(isFile);
      return nextResolve(found === undefined ? specifier : pathToFileURL(found).href, context);
    },
    load(url, context, nextLoad) {
      if (!url.startsWith(srcUrl)) return nextLoad(url, context);
      if (url.endsWith('.json')) {
        const source = `export default ${readFileSync(fileURLToPath(url), 'utf8')};`;
        return { format: 'module', source, shortCircuit: true };
      }
      if (url.endsWith('.ts')) return nextLoad(url, { ...context, format: 'module-typescript' });
      return nextLoad(url, context);
    },
  });
}
