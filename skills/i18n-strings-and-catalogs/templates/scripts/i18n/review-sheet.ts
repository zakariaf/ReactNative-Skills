// scripts/i18n/review-sheet.ts
// The review queue for translations an agent or a machine drafted. Never blocking: it always exits
// 0 with the count (2 only for bad input).
//   node scripts/i18n/review-sheet.ts [--release]
//     writes reports/i18n/review-<lang>.csv for each language in contracts/i18n.json
//     "reviewLanguages": every text whose SHA-256 differs from the hash in
//     scripts/i18n/review-state.json (key, source text, current text, where it shows)
//   node scripts/i18n/review-sheet.ts --mark-reviewed <lang> --date YYYY-MM-DD [--key <key>]...
//     records the current texts (or only the named keys) as reviewed, after the reviewer's
//     corrections are in the catalogs (and in contracts/copy-source.json, when the app has one)
// Run from the app folder: reports/ and review-state.json live there; contracts/ (i18n.json,
// copy-source.json) and the package catalog folders are read at the repo root (i18n-contract.ts).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { I18N_DIR, readAppLanguages } from './app-languages.ts';
import { catalogDirs, readRepoContract } from './i18n-contract.ts';

import type { I18nContract } from './i18n-contract.ts';

export type Catalog = Readonly<Record<string, string>>;
export type ReviewedText = { readonly sha256: string; readonly reviewedOn: string };
export type ReviewState = Readonly<Record<string, Readonly<Record<string, ReviewedText>>>>;
export type ReviewRow = {
  readonly key: string;
  readonly source: string;
  readonly current: string;
  readonly shownOn: string;
};
/** Keys that never go on a sheet, and the screen lists of the copy source. */
export type ReviewPolicy = {
  readonly untranslatedPrefixes: readonly string[];
  readonly screens: Readonly<Record<string, readonly string[]>>;
};
type Setup = {
  readonly sourceLanguage: string;
  readonly catalogs: Readonly<Record<string, Catalog>>;
  readonly reviewLanguages: readonly string[];
  readonly policy: ReviewPolicy;
};

export const REVIEW_STATE_FILE = 'scripts/i18n/review-state.json';
const REPORT_DIR = 'reports/i18n';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const USAGE =
  'Usage: node scripts/i18n/review-sheet.ts [--release] | --mark-reviewed <lang> --date YYYY-MM-DD [--key <key>]...';

export function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Where the reviewer sees a text: the system dialog, the screen of the copy source, or its area. */
export function shownOnOf(key: string, screens: ReviewPolicy['screens']): string {
  if (key.endsWith('.usage-description')) return 'iOS permission dialog (InfoPlist.strings)';
  const screen = Object.entries(screens).find(([, keys]) => keys.includes(key));
  return screen === undefined ? `area ${key.split('.')[0] ?? key}` : `screen ${screen[0]}`;
}

export function isReviewable(key: string, policy: ReviewPolicy): boolean {
  return !policy.untranslatedPrefixes.some((prefix) => key.startsWith(prefix));
}

/** Every reviewable text of one language that differs from its reviewed hash, sorted by key. */
export function pendingRows(input: {
  readonly source: Catalog;
  readonly catalog: Catalog;
  readonly reviewed: Readonly<Record<string, ReviewedText>>;
  readonly policy: ReviewPolicy;
}): ReviewRow[] {
  const { source, catalog, reviewed, policy } = input;
  return Object.keys(catalog)
    .filter((key) => isReviewable(key, policy))
    .filter((key) => reviewed[key]?.sha256 !== sha256Of(catalog[key] ?? ''))
    .sort()
    .map((key) => ({
      key,
      source: source[key] ?? '',
      current: catalog[key] ?? '',
      shownOn: shownOnOf(key, policy.screens),
    }));
}

const quoted = (field: string): string => `"${field.replaceAll('"', '""')}"`;

/** UTF-8 CSV with a byte-order mark, so spreadsheet apps show every script correctly. */
export function csvOf(rows: readonly ReviewRow[]): string {
  const lines = [
    ['key', 'source', 'current', 'shown on'],
    ...rows.map((row) => [row.key, row.source, row.current, row.shownOn]),
  ];
  return `﻿${lines.map((fields) => fields.map(quoted).join(',')).join('\n')}\n`;
}

/** The state after the reviewer read the current texts of `keys` (every reviewable key when empty). */
export function markReviewed(
  state: ReviewState,
  catalog: Catalog,
  mark: {
    readonly language: string;
    readonly date: string;
    readonly keys: readonly string[];
    readonly policy: ReviewPolicy;
  },
): ReviewState {
  const reviewable = (key: string): boolean => isReviewable(key, mark.policy);
  const keys = mark.keys.length > 0 ? mark.keys : Object.keys(catalog).filter(reviewable);
  const entries = keys.map((key): [string, ReviewedText] => {
    if (!reviewable(key))
      throw new Error(`review-sheet: ${key} keeps the source text: never reviewed`);
    const text = catalog[key];
    if (text === undefined)
      throw new Error(`review-sheet: ${key} is not in the ${mark.language} catalogs`);
    return [key, { sha256: sha256Of(text), reviewedOn: mark.date }];
  });
  const merged = Object.entries({ ...state[mark.language], ...Object.fromEntries(entries) });
  const sorted = merged.sort(([a], [b]) => (a < b ? -1 : 1));
  return { ...state, [mark.language]: Object.fromEntries(sorted) };
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

function readSetup(root: string): Setup {
  const contract = readRepoContract<I18nContract>(root, 'i18n.json', {});
  const copy = readRepoContract<{ screens?: ReviewPolicy['screens'] }>(
    root,
    'copy-source.json',
    {},
  );
  const dirs = catalogDirs(root, contract);
  const { sourceLanguage } = readAppLanguages(root);
  if (!existsSync(join(dirs[0] ?? '', `${sourceLanguage}.json`))) {
    throw new Error(`review-sheet: no ${sourceLanguage} catalog in ${I18N_DIR}/catalogs`);
  }
  const reviewLanguages = contract.reviewLanguages ?? [];
  const merged = (language: string): Catalog => {
    const catalog: Record<string, string> = {};
    for (const dir of dirs) {
      Object.assign(catalog, readJson<Catalog>(join(dir, `${language}.json`), {}));
    }
    return catalog;
  };
  const languages = [sourceLanguage, ...reviewLanguages];
  return {
    sourceLanguage,
    catalogs: Object.fromEntries(languages.map((language) => [language, merged(language)])),
    reviewLanguages,
    policy: {
      untranslatedPrefixes: contract.untranslatedPrefixes ?? [],
      screens: copy.screens ?? {},
    },
  };
}

function writeSheets(root: string): number {
  const { sourceLanguage, catalogs, reviewLanguages, policy } = readSetup(root);
  const state = readJson<ReviewState>(join(root, REVIEW_STATE_FILE), {});
  mkdirSync(join(root, REPORT_DIR), { recursive: true });
  let pending = 0;
  for (const language of reviewLanguages) {
    const catalog = catalogs[language] ?? {};
    const source = catalogs[sourceLanguage] ?? {};
    const rows = pendingRows({ source, catalog, reviewed: state[language] ?? {}, policy });
    const file = `${REPORT_DIR}/review-${language}.csv`;
    writeFileSync(join(root, file), csvOf(rows));
    pending += rows.length;
    const total = Object.keys(catalog).filter((key) => isReviewable(key, policy)).length;
    console.log(
      `review-sheet: ${language}: ${String(rows.length)} of ${String(total)} texts wait for review -> ${file}`,
    );
  }
  console.log(
    pending > 0
      ? `REVIEW PENDING (not blocking): ${String(pending)} drafted texts in ${REPORT_DIR}/; list them in the report for the reviewer. Nothing waits for it.`
      : 'review-sheet: every drafted text has been reviewed',
  );
  return 0;
}

function writeMark(
  root: string,
  values: { readonly language: string; readonly date?: string; readonly keys: readonly string[] },
): number {
  const { catalogs, reviewLanguages, policy } = readSetup(root);
  const { language, date } = values;
  if (!reviewLanguages.includes(language) || date === undefined || !DATE_KEY.test(date)) {
    throw new Error(
      `review-sheet: --mark-reviewed needs a review language (${reviewLanguages.join(', ')}) and --date YYYY-MM-DD`,
    );
  }
  const state = readJson<ReviewState>(join(root, REVIEW_STATE_FILE), {});
  const next = markReviewed(state, catalogs[language] ?? {}, {
    language,
    date,
    keys: values.keys,
    policy,
  });
  mkdirSync(dirname(join(root, REVIEW_STATE_FILE)), { recursive: true });
  writeFileSync(join(root, REVIEW_STATE_FILE), `${JSON.stringify(next, null, 2)}\n`);
  const count = Object.keys(next[language] ?? {}).length;
  console.log(`review-sheet: ${language}: ${String(count)} texts recorded as reviewed on ${date}`);
  return 0;
}

/** The command line. Returns the exit code: 0 whatever waits for review, 2 for bad input. */
export function runReviewSheet(root: string, argv: readonly string[]): number {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        release: { type: 'boolean', default: false },
        'mark-reviewed': { type: 'string' },
        date: { type: 'string' },
        key: { type: 'string', multiple: true, default: [] },
      },
    });
    const language = values['mark-reviewed'];
    if (language === undefined) return writeSheets(root);
    const keys = values.key;
    return writeMark(
      root,
      values.date === undefined ? { language, keys } : { language, date: values.date, keys },
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }
}

if ((process.argv[1] ?? '').endsWith('review-sheet.ts')) {
  process.exitCode = runReviewSheet(process.cwd(), process.argv.slice(2));
}
