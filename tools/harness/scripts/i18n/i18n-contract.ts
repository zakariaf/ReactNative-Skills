// scripts/i18n/i18n-contract.ts
// Where the i18n tooling finds the repo's contracts. The tooling runs from the app folder (npm runs
// scripts there); contracts/ sits at the repo root, as for the skill's checkers: the app folder in a
// single-app repo, or in a monorepo the nearest folder above the app whose package.json
// "workspaces" lists it. Catalog folders a contract names ("dir") are relative to that repo root.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { I18N_DIR } from './app-languages.ts';

export type ContractCatalog = {
  readonly dir: string;
  readonly keyPrefix: string;
  readonly sourceDir?: string;
};
export type I18nContract = {
  readonly untranslatedPrefixes?: readonly string[];
  readonly reviewLanguages?: readonly string[];
  readonly catalogs?: readonly ContractCatalog[];
};

/** The "workspaces" globs of dir/package.json (npm's list or yarn's { packages }), or []. */
function workspaceGlobs(dir: string): string[] {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return [];
  const { workspaces } = JSON.parse(readFileSync(file, 'utf8')) as {
    readonly workspaces?: unknown;
  };
  const list = Array.isArray(workspaces)
    ? (workspaces as unknown[])
    : (workspaces as { readonly packages?: unknown } | undefined)?.packages;
  return Array.isArray(list) ? list.filter((glob): glob is string => typeof glob === 'string') : [];
}

/** 'apps/*' matches 'apps/mobile'; '**' matches any depth. */
function globMatches(rel: string, glob: string): boolean {
  const pattern = glob
    .replace(/\/+$/, '')
    .split('/')
    .map((part) =>
      part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`).test(rel);
}

/** The repo root of an app folder: the nearest folder above it whose "workspaces" lists it, else the app folder. */
export function repoRootOf(appRoot: string): string {
  const start = resolve(appRoot);
  for (let dir = dirname(start); dir !== dirname(dir); dir = dirname(dir)) {
    const rel = relative(dir, start).split(sep).join('/');
    if (workspaceGlobs(dir).some((glob) => globMatches(rel, glob))) return dir;
  }
  return start;
}

/** contracts/<name> at the repo root, parsed, or `fallback` when the file does not exist. */
export function readRepoContract<T>(appRoot: string, name: string, fallback: T): T {
  const file = join(repoRootOf(appRoot), 'contracts', name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
}

/** The absolute catalog folders: the app's own, then every package folder of contracts/i18n.json. */
export function catalogDirs(appRoot: string, contract: I18nContract): string[] {
  const repoRoot = repoRootOf(appRoot);
  return [
    join(resolve(appRoot), I18N_DIR, 'catalogs'),
    ...(contract.catalogs ?? []).map((entry) => join(repoRoot, entry.dir)),
  ];
}
