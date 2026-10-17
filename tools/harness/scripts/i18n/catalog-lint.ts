// scripts/i18n/catalog-lint.ts
// Lints one catalog folder in every language: the file names, the message rules, sorting,
// untranslated keys and =N branch parity. Each problem reads like the skill's check-catalogs.mjs:
// '<file>:<line> [<id> <name>] <key>: <message>'. The CLI is verify-catalogs.ts (`npm run
// i18n:verify`); FormatJS's structural check adds missing and extra keys and placeholder types.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isUntranslated, lintMessage, parseMessage, ruleLabel } from './catalog-lint-rules.ts';
import { walk } from './icu-walk.ts';

import type { CatalogPolicy, RuleId } from './catalog-lint-rules.ts';

export type Catalog = Readonly<Record<string, string>>;
type CatalogFile = { readonly file: string; readonly text: string; readonly catalog: Catalog };
/** Where a problem is: a file and a 1-based line. */
type Where = { readonly file: string; readonly line: number };
export type LintOptions = {
  readonly languages: readonly string[];
  readonly policy: CatalogPolicy;
  /** Shortens the file paths (verify-catalogs: relative to the app folder). */
  readonly label?: (file: string) => string;
};

/** One problem line: '<file>:<line> [<id> <name>] <message>'. */
export function problemLine({ file, line }: Where, id: RuleId, message: string): string {
  return `${file}:${String(line)} ${ruleLabel(id)} ${message}`;
}

/** The 1-based line of a key in a catalog's text (its first occurrence), or 1. */
export function lineOfKey(text: string, key: string): number {
  const at = text.indexOf(`${JSON.stringify(key)}:`);
  return at === -1 ? 1 : text.slice(0, at).split('\n').length;
}

/** A tag in BCP 47 canonical casing: language lower, Script title, REGION upper, the rest lower. */
export function canonicalCasing(tag: string): string {
  return tag
    .split('-')
    .map((subtag, index) => {
      if (index === 0) return subtag.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(subtag)) {
        return `${subtag.charAt(0).toUpperCase()}${subtag.slice(1).toLowerCase()}`;
      }
      return /^([A-Za-z]{2}|\d{3})$/.test(subtag) ? subtag.toUpperCase() : subtag.toLowerCase();
    })
    .join('-');
}

/** The name the folder really has for <language>.json, matched without case, or undefined. */
function actualName(dir: string, language: string): string | undefined {
  const name = `${language}.json`;
  return readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase());
}

/** F1: the language's tag casing and the file's exact name (a Mac finds pt-br.json for pt-BR; Linux does not). */
function fileNameProblems(dir: string, language: string): string[] {
  const name = `${language}.json`;
  const problems: string[] = [];
  const want = canonicalCasing(language);
  if (want !== language) {
    const message = `"${language}" in LANGUAGES is not in BCP 47 canonical casing: the tag is "${want}"`;
    problems.push(problemLine({ file: join(dir, name), line: 1 }, 'F1', message));
  }
  const actual = actualName(dir, language);
  if (actual !== undefined && actual !== name) {
    const message = `the catalog is named ${actual}, but LANGUAGES spells the tag ${language}: Linux CI and EAS Build cannot find ${name} (a case-insensitive Mac can)`;
    problems.push(problemLine({ file: join(dir, actual), line: 1 }, 'F1', message));
  }
  return problems;
}

/** The catalog of one language, or an F1 problem line (missing, not JSON, not a flat object of strings). */
export function readCatalog(dir: string, language: string): CatalogFile | string {
  const actual = actualName(dir, language);
  const file = join(dir, actual ?? `${language}.json`);
  if (actual === undefined)
    return problemLine({ file, line: 1 }, 'F1', `${language}.json is missing`);
  const text = readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return problemLine({ file, line: 1 }, 'F1', `not valid JSON: ${String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return problemLine({ file, line: 1 }, 'F1', 'not a flat JSON object');
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      return problemLine(
        { file, line: lineOfKey(text, key) },
        'F1',
        `${key}: value is not a string`,
      );
    }
  }
  return { file, text, catalog: parsed as Catalog };
}

export function sortProblems({ file, text, catalog }: CatalogFile): string[] {
  const keys = Object.keys(catalog);
  const sorted = [...keys].sort();
  const first = keys.find((key, index) => key !== sorted[index]);
  if (first === undefined) return [];
  const message = `keys are not sorted (first out of place: "${first}")`;
  return [problemLine({ file, line: lineOfKey(text, first) }, 'L12', message)];
}

/** The =N branches of each plural placeholder, sorted: openCount -> '=0'. */
function exactBranches(message: string): Map<string, string> {
  const parsed = parseMessage(message);
  const found = new Map<string, string[]>();
  if (!Array.isArray(parsed)) return new Map();
  walk(parsed, (el) => {
    if ('options' in el && 'pluralType' in el) {
      const exact = Object.keys(el.options).filter((option) => option.startsWith('='));
      found.set(el.value, [...(found.get(el.value) ?? []), ...exact]);
    }
  });
  return new Map([...found].map(([name, list]) => [name, [...new Set(list)].sort().join(' ')]));
}

/** P4: the same =N branches per plural placeholder as the source message. */
function exactBranchProblems(sourceText: string, text: string, sourceLanguage: string): string[] {
  const left = exactBranches(sourceText);
  const right = exactBranches(text);
  const shown = (branches: string): string => (branches === '' ? 'none' : branches);
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((name) => (left.get(name) ?? '') !== (right.get(name) ?? ''))
    .map(
      (name) =>
        `plural {${name}} has exact branches [${shown(right.get(name) ?? '')}] but ${sourceLanguage} has [${shown(left.get(name) ?? '')}]`,
    );
}

/** P4 and P5 for one translated catalog against the source catalog. */
export function parityProblems(
  source: Catalog,
  target: CatalogFile,
  ctx: { readonly language: string; readonly policy: CatalogPolicy },
): string[] {
  const { sourceLanguage } = ctx.policy;
  const problems: string[] = [];
  for (const [key, text] of Object.entries(target.catalog)) {
    const sourceText = source[key];
    if (sourceText === undefined) continue;
    const at = { file: target.file, line: lineOfKey(target.text, key) };
    if (isUntranslated(key, ctx.policy) && text !== sourceText) {
      const message = `${key}: keeps the source text in every language (untranslatedPrefixes), but ${ctx.language} says ${JSON.stringify(text)} where ${sourceLanguage} says ${JSON.stringify(sourceText)}`;
      problems.push(problemLine(at, 'P5', message));
    }
    for (const message of exactBranchProblems(sourceText, text, sourceLanguage)) {
      problems.push(problemLine(at, 'P4', `${key}: ${message}`));
    }
  }
  return problems;
}

function lintFolder(dir: string, { languages, policy }: LintOptions): string[] {
  const report: string[] = [];
  const catalogs = new Map<string, CatalogFile>();
  for (const language of languages) {
    report.push(...fileNameProblems(dir, language));
    const read = readCatalog(dir, language);
    if (typeof read === 'string') report.push(read);
    else catalogs.set(language, read);
  }
  const source = catalogs.get(policy.sourceLanguage);
  for (const [language, target] of catalogs) {
    report.push(...sortProblems(target));
    if (source !== undefined && language !== policy.sourceLanguage) {
      report.push(...parityProblems(source.catalog, target, { language, policy }));
    }
    for (const [key, message] of Object.entries(target.catalog)) {
      const at = { file: target.file, line: lineOfKey(target.text, key) };
      for (const found of lintMessage({ language, key, message, policy })) {
        report.push(problemLine(at, found.id, `${key}: ${found.message}`));
      }
    }
  }
  return report;
}

/** Every problem of one catalog folder, one line each. */
export function lintDirectory(dir: string, options: LintOptions): string[] {
  const { label = (file: string): string => file } = options;
  return lintFolder(dir, options).map((line) => {
    const at = line.search(/:\d+ \[/);
    return at === -1 ? line : `${label(line.slice(0, at))}${line.slice(at)}`;
  });
}
