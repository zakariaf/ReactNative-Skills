// i18n-config.mjs: where an app's i18n facts live, read the same way by every checker of this skill.
// Not an entry point.
//
//   resolveAppLayout(root, { appDir, i18nDir }) -> resolveLayout(root) plus appDir: with --app-dir
//       (the Expo app's folder in a monorepo) srcDir, i18nDir and aliases come from that folder
//   appFile(layout, name) -> the repo-relative path of an app-level file (package.json, jest.config.js)
//   noLanguagesFix(layout) -> the fix text when no language list exists (names the workspaces)
//   readLanguages(root, layout, { languages }) -> { languages, sourceLanguage, file }
//       the app's languages: --languages en,ar, else LANGUAGES and SOURCE_LANGUAGE in
//       <i18nDir>/languages.ts (plain literals); null when neither exists
//   readContract(root, layout, { contract }) -> { file, exists, untranslatedPrefixes,
//       reviewLanguages, isolatedFormatters, catalogs: [{ dir, keyPrefix, sourceDir }] }
//       contracts/i18n.json (optional; every key has a strict default)
//   catalogFolders(layout, contract) -> [{ dir, keyPrefix, reservedPrefixes, isMain }]
//   readCatalogKeys(root, dir, language) -> Set of keys, or null (missing or unreadable file)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fail, readTsconfigPaths, resolveLayout, toPosix } from '../check-lib.mjs';
import { findConstInitializer, LiteralError, parseValue } from './ts-literal.mjs';

export const CONTRACT_NAME = 'i18n.json';
export const DEFAULT_ISOLATED_FORMATTERS = Object.freeze(['formatDayMonth', 'formatWeekdayDayMonth']);
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const KEY_PREFIX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CONTRACT_KEYS = new Set(['$comment', '$schema', 'untranslatedPrefixes', 'reviewLanguages', 'isolatedFormatters', 'catalogs']);
const CATALOG_KEYS = new Set(['dir', 'keyPrefix', 'sourceDir']);

function checkLanguage(code, where) {
  if (typeof code !== 'string' || !LANGUAGE_CODE.test(code)) {
    fail(`${where}: "${code}" is not a language code`, 'Use BCP 47 language codes such as en, ar, pt-BR.');
  }
  if (Intl.PluralRules.supportedLocalesOf(code).length === 0) {
    fail(`${where}: Node's ICU has no plural rules for "${code}"`, 'Run the checkers on an official Node build (full ICU), or fix the code.');
  }
}

function literalConst(source, name, file) {
  const at = findConstInitializer(source, name);
  if (at === -1) return undefined;
  try {
    return parseValue(source, at).value;
  } catch (error) {
    if (error instanceof LiteralError) fail(`${file}: ${name} is not literal data (${error.message})`, `Write ${name} as a literal, e.g. export const ${name} = ['en', 'ar'] as const;`);
    throw error;
  }
}

/**
 * The app's folders. Without appDir: check-lib's resolveLayout for the repo. With appDir (the Expo
 * app's folder in a monorepo, e.g. apps/mobile): srcDir, i18nDir and the tsconfig aliases come from
 * that folder (its rn-skills.config.json "workspaces" entry applies when package.json "workspaces"
 * lists it), while contracts stay at the repo level, because the contract also names package
 * catalogs elsewhere in the repo. layout.appDir is '' for the repo root.
 */
export function resolveAppLayout(root, { appDir, i18nDir } = {}) {
  const repo = resolveLayout(root, { i18nDir });
  const given = appDir === undefined ? '' : toPosix(appDir).replace(/\/+$/, '');
  const dir = given === '.' ? '' : given.replace(/^\.\//, '');
  if (dir === '') return { ...repo, appDir: '' };
  if (dir.startsWith('/') || dir.split('/').includes('..')) fail(`--app-dir must be a repo-relative folder, got "${appDir}"`, 'Pass the app folder relative to the repo root, e.g. --app-dir apps/mobile.');
  if (!existsSync(join(root, dir))) fail(`nothing to check: --app-dir ${dir} does not exist`, 'Pass the folder that holds the Expo app (its package.json and app.config.ts).');
  const workspace = repo.workspaces.find((entry) => entry.dir === dir);
  if (workspace) {
    const app = workspace.layout;
    return { ...repo, srcDir: app.srcDir, i18nDir: i18nDir ?? app.i18nDir, aliases: app.aliases, tsconfig: app.tsconfig, appDir: dir };
  }
  const srcDir = `${dir}/src`;
  const tsconfig = readTsconfigPaths(root, `${dir}/tsconfig.json`);
  return { ...repo, srcDir, i18nDir: i18nDir ?? `${srcDir}/i18n`, aliases: tsconfig?.aliases ?? repo.aliases, tsconfig: tsconfig?.file ?? repo.tsconfig, appDir: dir };
}

/** The repo-relative path of a file at the app's root (package.json, jest.config.js, app.config.ts). */
export function appFile(layout, name) {
  return layout.appDir ? `${layout.appDir}/${name}` : name;
}

/** The fix when there is no language list; in a monorepo it names the workspaces --app-dir takes. */
export function noLanguagesFix(layout) {
  const create = `Create ${layout.i18nDir}/languages.ts from the skill's templates (LANGUAGES, SOURCE_LANGUAGE), or pass --languages en,ar.`;
  if (layout.appDir || layout.workspaces.length === 0) return create;
  return `${create} In a monorepo, pass the app's workspace: --app-dir ${layout.workspaces.map((entry) => entry.dir).join(' | ')}.`;
}

/** The app's languages and its source language, or null when there is no list to read. */
export function readLanguages(root, layout, { languages } = {}) {
  if (languages) {
    const list = languages.split(',').map((code) => code.trim()).filter(Boolean);
    list.forEach((code) => checkLanguage(code, '--languages'));
    if (list.length === 0) fail('--languages is empty', 'Pass the languages, source first: --languages en,ar.');
    return { languages: list, sourceLanguage: list[0], file: null };
  }
  const file = `${layout.i18nDir}/languages.ts`;
  if (!existsSync(join(root, file))) return null;
  const source = readFileSync(join(root, file), 'utf8');
  const list = literalConst(source, 'LANGUAGES', file);
  if (!Array.isArray(list) || list.length === 0) fail(`${file} has no LANGUAGES list`, "Export the app's languages: export const LANGUAGES = ['en', 'ar'] as const;");
  list.forEach((code) => checkLanguage(code, file));
  const sourceLanguage = literalConst(source, 'SOURCE_LANGUAGE', file) ?? list[0];
  if (!list.includes(sourceLanguage)) fail(`${file}: SOURCE_LANGUAGE "${sourceLanguage}" is not in LANGUAGES`, 'Make SOURCE_LANGUAGE one of LANGUAGES.');
  return { languages: list, sourceLanguage, file };
}

function stringList(value, key, file) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) fail(`${file}: "${key}" must be a list of non-empty strings`, `Fix "${key}" (see the skill's assets/i18n-contract.schema.json).`);
  return value;
}

function repoDir(value, where, file) {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.split('/').includes('..')) {
    fail(`${file}: ${where} must be a repo-relative folder`, 'Write a path relative to the repo root, without .. or a leading /.');
  }
  return toPosix(value).replace(/\/+$/, '');
}

function readCatalogEntries(value, file) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${file}: "catalogs" must be a list`, 'Write "catalogs": [{ "dir": "...", "keyPrefix": "..." }].');
  return value.map((entry, index) => {
    const where = `catalogs[${index}]`;
    if (typeof entry !== 'object' || entry === null) fail(`${file}: ${where} must be an object`, 'Write { "dir": "...", "keyPrefix": "..." }.');
    const unknown = Object.keys(entry).filter((key) => !CATALOG_KEYS.has(key));
    if (unknown.length > 0) fail(`${file}: ${where} has unknown keys ${unknown.join(', ')}`, `Use only ${[...CATALOG_KEYS].join(', ')}.`);
    if (typeof entry.keyPrefix !== 'string' || !KEY_PREFIX.test(entry.keyPrefix)) fail(`${file}: ${where}.keyPrefix must be one kebab-case key segment`, 'For example "billing".');
    return {
      dir: repoDir(entry.dir, `${where}.dir`, file),
      keyPrefix: entry.keyPrefix,
      sourceDir: entry.sourceDir === undefined ? null : repoDir(entry.sourceDir, `${where}.sourceDir`, file),
    };
  });
}

/** contracts/i18n.json, validated; defaults when the file does not exist. */
export function readContract(root, layout, { contract } = {}) {
  const file = contract ?? `${layout.contractsDir}/${CONTRACT_NAME}`;
  const empty = { file, exists: false, untranslatedPrefixes: [], reviewLanguages: [], isolatedFormatters: [...DEFAULT_ISOLATED_FORMATTERS], catalogs: [] };
  if (!existsSync(join(root, file))) {
    if (contract) fail(`contract ${file} does not exist`, 'Pass an existing file, or leave --contract out.');
    return empty;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`, 'Fix the JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail(`${file} must hold a JSON object`, 'See the skill\'s templates/contracts/i18n.json.');
  const unknown = Object.keys(data).filter((key) => !CONTRACT_KEYS.has(key));
  if (unknown.length > 0) fail(`${file} has unknown keys: ${unknown.join(', ')}`, `Use only ${[...CONTRACT_KEYS].filter((key) => !key.startsWith('$')).join(', ')}.`);
  const isolated = data.isolatedFormatters === undefined ? [...DEFAULT_ISOLATED_FORMATTERS] : stringList(data.isolatedFormatters, 'isolatedFormatters', file);
  return {
    file,
    exists: true,
    untranslatedPrefixes: stringList(data.untranslatedPrefixes, 'untranslatedPrefixes', file),
    reviewLanguages: stringList(data.reviewLanguages, 'reviewLanguages', file),
    isolatedFormatters: isolated,
    catalogs: readCatalogEntries(data.catalogs, file),
  };
}

/** Every catalog folder: the app's (no prefix), then each package folder of the contract. */
export function catalogFolders(layout, contract) {
  const prefixes = contract.catalogs.map((entry) => entry.keyPrefix);
  return [
    { dir: `${layout.i18nDir}/catalogs`, keyPrefix: null, reservedPrefixes: prefixes, isMain: true },
    ...contract.catalogs.map((entry) => ({
      dir: entry.dir,
      keyPrefix: entry.keyPrefix,
      reservedPrefixes: prefixes.filter((prefix) => prefix !== entry.keyPrefix),
      isMain: false,
    })),
  ];
}

/** The keys of one catalog file, or null when it is missing or not a JSON object. */
export function readCatalogKeys(root, dir, language) {
  const file = join(root, dir, `${language}.json`);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? new Set(Object.keys(data)) : null;
  } catch {
    return null;
  }
}
