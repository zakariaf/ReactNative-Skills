// scripts/i18n/verify-catalogs.ts
// `npm run i18n:verify` (quality-gates' `npm run verify` runs it, and so CI): FormatJS's structural
// check (missing and extra keys, placeholder types) plus this repo's catalog linter, for the app's
// catalogs and every package catalog of contracts/i18n.json (read at the repo root, see
// i18n-contract.ts). Exit 1 on any problem. Needs @formatjs/cli and
// @formatjs/icu-messageformat-parser as exact devDependencies; the binary is resolved the way Node
// resolves packages, so a workspace that hoists it to the repo root works too.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

import { readAppLanguages } from './app-languages.ts';
import { lintDirectory } from './catalog-lint.ts';
import { catalogDirs, readRepoContract } from './i18n-contract.ts';

import type { CatalogPolicy } from './catalog-lint-rules.ts';
import type { I18nContract } from './i18n-contract.ts';

/** Runs `formatjs <args>`; true when it exits 0. */
export type FormatjsRunner = (args: readonly string[]) => boolean;
type Folder = { readonly dir: string; readonly policy: CatalogPolicy };

/** The @formatjs/cli the app resolves, or null when it is not installed. */
export function formatjsRunner(appRoot: string): FormatjsRunner | null {
  let manifest: string;
  try {
    manifest = createRequire(join(appRoot, 'package.json')).resolve('@formatjs/cli/package.json');
  } catch {
    return null;
  }
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: Record<string, string> };
  const script = join(dirname(manifest), bin['formatjs'] ?? 'bin/formatjs');
  return (args) => {
    try {
      execFileSync(process.execPath, [script, ...args], { stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  };
}

function foldersOf(appRoot: string, contract: I18nContract, sourceLanguage: string): Folder[] {
  const prefixes = (contract.catalogs ?? []).map((entry) => entry.keyPrefix);
  const policy = (keyPrefix: string | null): CatalogPolicy => ({
    sourceLanguage,
    untranslatedPrefixes: contract.untranslatedPrefixes ?? [],
    keyPrefix,
    reservedPrefixes: prefixes.filter((prefix) => prefix !== keyPrefix),
  });
  const [appDir = '', ...packageDirs] = catalogDirs(appRoot, contract);
  return [
    { dir: appDir, policy: policy(null) },
    ...packageDirs.map((dir, index) => ({ dir, policy: policy(prefixes[index] ?? null) })),
  ];
}

function lintProblems(appRoot: string, folder: Folder, languages: readonly string[]): string[] {
  try {
    const label = (file: string): string => relative(appRoot, file);
    return lintDirectory(folder.dir, { languages, policy: folder.policy, label });
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

/** Lints and verifies every catalog folder; returns the exit code. */
export function verifyCatalogs(
  appRoot: string,
  runFormatjs: FormatjsRunner | null,
  log: (line: string) => void,
): number {
  if (runFormatjs === null) {
    log('i18n:verify: @formatjs/cli is not installed (npm install -D -E @formatjs/cli)');
    return 1;
  }
  const app = readAppLanguages(appRoot);
  const contract = readRepoContract<I18nContract>(appRoot, 'i18n.json', {});
  const verify = [
    'verify',
    '--source-locale',
    app.sourceLanguage,
    '--missing-keys',
    '--extra-keys',
  ];
  let failures = 0;
  for (const folder of foldersOf(appRoot, contract, app.sourceLanguage)) {
    const problems = lintProblems(appRoot, folder, app.languages);
    problems.forEach(log);
    const files = app.languages.map((language) => join(folder.dir, `${language}.json`));
    const isStructurallyEqual = runFormatjs([...verify, '--structural-equality', ...files]);
    if (!isStructurallyEqual || problems.length > 0) failures += 1;
  }
  log(`i18n:verify: ${String(failures)} catalog folder(s) failing`);
  return failures === 0 ? 0 : 1;
}

if ((process.argv[1] ?? '').endsWith('verify-catalogs.ts')) {
  const appRoot = process.cwd();
  process.exitCode = verifyCatalogs(appRoot, formatjsRunner(appRoot), (line) => {
    console.error(line);
  });
}
