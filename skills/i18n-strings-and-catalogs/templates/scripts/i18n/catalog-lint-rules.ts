// scripts/i18n/catalog-lint-rules.ts
// The message rules behind `npm run i18n:verify`, with the same rule ids, names and messages as the
// i18n-strings-and-catalogs skill's check-catalogs.mjs (L1-L13 here, P4, P5 and F1 in
// catalog-lint.ts; FormatJS's own report covers missing and extra keys and placeholder types), so
// CI needs no installed skill. Plural categories and scripts come from Node's ICU
// (Intl.PluralRules, Intl.Locale): any language the app adds is checked with its own CLDR rules.
import {
  isArgumentElement,
  isDateElement,
  isLiteralElement,
  isNumberElement,
  isPluralElement,
  isPoundElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  parse,
} from '@formatjs/icu-messageformat-parser';

import { walk } from './icu-walk.ts';

import type { MessageFormatElement, PluralElement } from '@formatjs/icu-messageformat-parser';

/** What a catalog folder allows. */
export type CatalogPolicy = {
  readonly sourceLanguage: string;
  /** Keys under these prefixes keep the source text in every language (developer-only screens). */
  readonly untranslatedPrefixes: readonly string[];
  /** When multi-package: every key of this folder starts with `<keyPrefix>.`. */
  readonly keyPrefix: string | null;
  /** The prefixes of the other catalog folders, which this folder's keys must not use. */
  readonly reservedPrefixes: readonly string[];
};
export type MessageContext = {
  readonly language: string;
  readonly key: string;
  readonly message: string;
  readonly policy: CatalogPolicy;
};

/** The ids and names check-catalogs.mjs prints for the rules this linter runs. */
export const RULE_NAMES = {
  L1: 'key-shape',
  L1b: 'key-namespace',
  L2: 'icu-syntax',
  L3: 'no-date-time-tags',
  L4: 'placeholder-name',
  L5: 'plural-categories',
  L6: 'count-needs-plural',
  L7: 'literal-digits',
  L8: 'bidi-controls',
  L9: 'arabic-letters',
  L10: 'latin-punctuation',
  L11: 'sentence-shape',
  L12: 'keys-sorted',
  L13: 'system-text-plain',
  P4: 'exact-plural-parity',
  P5: 'untranslated-prefix',
  F1: 'catalog-file',
} as const;
export type RuleId = keyof typeof RULE_NAMES;
export type LintProblem = { readonly id: RuleId; readonly message: string };

/** '[L6 count-needs-plural]', as the checker prints it. */
export function ruleLabel(id: RuleId): string {
  return `[${id} ${RULE_NAMES[id]}]`;
}

const problem = (id: RuleId, message: string): LintProblem => ({ id, message });

const KEY_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){1,4}$/;
const ARG_NAME = /^[a-z][A-Za-z0-9]*$/;
const TEXT_ARG = /(Name|Text)$/;
const EXACT = /^=\d+$/;
const ANY_DIGIT = /\p{Nd}/u;
const BANNED_CONTROLS = /[؜‪-‮⁦-⁩]/;
const ARABIC_ONLY_LETTERS = /[يك]/;
const LATIN_PUNCTUATION = /[,;?]/;
const JOINER_EDGE = /^[\s,;:+&/–-]|[\s,;:+&/–-]$/;
const SYSTEM_TEXT_SUFFIX = '.usage-description';
const PERSIAN_LETTER_LANGUAGES = new Set(['fa', 'prs', 'ckb', 'ur']);
const CASED_SCRIPTS = new Set(['Latn', 'Cyrl', 'Grek', 'Armn']);
/** Scripts written without spaces between words: a word after a number is no sign of a count there. */
const UNSPACED_SCRIPTS = new Set('Hani Hans Hant Jpan Thai Laoo Khmr Mymr Tibt'.split(' '));

export function isUntranslated(key: string, policy: CatalogPolicy): boolean {
  return policy.untranslatedPrefixes.some((prefix) => key.startsWith(prefix));
}

function scriptOf(language: string): string {
  try {
    return new Intl.Locale(language).maximize().script ?? '';
  } catch {
    return '';
  }
}

type PluralType = 'cardinal' | 'ordinal';

/** A category holding only a few fixed integers (ar zero = 0) is covered when each has its =N. */
function coveredByExact(rules: Intl.PluralRules, category: string, exact: Set<number>): boolean {
  const members: number[] = [];
  for (let n = 0; n <= 1000 && members.length <= 9; n += 1) {
    if (rules.select(n) === category) members.push(n);
  }
  return members.length > 0 && members.length <= 9 && members.every((n) => exact.has(n));
}

function checkPlural(el: PluralElement, language: string): LintProblem[] {
  if (el.offset !== 0) {
    return [
      problem('L5', 'plural offset is not allowed: give the other count its own placeholder'),
    ];
  }
  const type: PluralType = el.pluralType === 'ordinal' ? 'ordinal' : 'cardinal';
  const rules = new Intl.PluralRules(language, { type });
  const allowed: readonly string[] = rules.resolvedOptions().pluralCategories;
  const options = Object.keys(el.options);
  const exact = new Set(options.filter((o) => EXACT.test(o)).map((o) => Number(o.slice(1))));
  const unknown = options.filter((o) => !EXACT.test(o) && !allowed.includes(o));
  const missing = allowed.filter((c) => !options.includes(c) && !coveredByExact(rules, c, exact));
  const has = `${language} has ${allowed.join(', ')}`;
  return [
    ...unknown.map((o) =>
      problem(
        'L5',
        `plural category "${o}" does not exist in ${language} (${type}: ${allowed.join(', ')})`,
      ),
    ),
    ...(missing.length > 0
      ? [
          problem(
            'L5',
            `{${el.value}} lacks the ${language} ${type} categories ${missing.join(', ')} (${has})`,
          ),
        ]
      : []),
  ];
}

function checkPlaceholderName(el: MessageFormatElement): LintProblem[] {
  if (isLiteralElement(el) || isPoundElement(el)) return [];
  const name = el.value;
  if (!ARG_NAME.test(name)) return [problem('L4', `placeholder "${name}" must be camelCase`)];
  if (isArgumentElement(el) && !TEXT_ARG.test(name)) {
    const message = `{${name}} is plain text: name it *Name/*Text, or use {${name}, number} / plural`;
    return [problem('L4', message)];
  }
  if (!isArgumentElement(el) && !isTagElement(el) && TEXT_ARG.test(name)) {
    const message = `"${name}" ends in Name/Text, which is reserved for plain-text placeholders`;
    return [problem('L4', message)];
  }
  return [];
}

function checkLiteral(value: string, ctx: MessageContext): LintProblem[] {
  const isKeepingSource = isUntranslated(ctx.key, ctx.policy);
  const base = ctx.language.split('-')[0] ?? ctx.language;
  const problems: LintProblem[] = [];
  if (ANY_DIGIT.test(value)) {
    problems.push(problem('L7', 'literal digits: numbers must be placeholders'));
  }
  if (BANNED_CONTROLS.test(value)) {
    problems.push(problem('L8', 'bidi controls/ALM in catalog: t() isolates values'));
  }
  if (!isKeepingSource && PERSIAN_LETTER_LANGUAGES.has(base) && ARABIC_ONLY_LETTERS.test(value)) {
    problems.push(problem('L9', 'Arabic ي/ك: use ی/ک'));
  }
  if (!isKeepingSource && scriptOf(ctx.language) === 'Arab' && LATIN_PUNCTUATION.test(value)) {
    problems.push(problem('L10', 'Latin , ; ? in Arabic-script text: use ، ؛ ؟'));
  }
  return problems;
}

/**
 * L6 applies to the source language when its number forms differ (more than one cardinal category)
 * and its script puts spaces between words: en, de, es, ar, ru, hi... (not ja, zh, th, ko, vi). The
 * translations follow the source's plural through P3.
 */
export function countNeedsPlural(language: string, policy: CatalogPolicy): boolean {
  if (language !== policy.sourceLanguage || UNSPACED_SCRIPTS.has(scriptOf(language))) return false;
  return new Intl.PluralRules(language).resolvedOptions().pluralCategories.length > 1;
}

function checkCountNeedsPlural(
  el: MessageFormatElement,
  next: MessageFormatElement | undefined,
): LintProblem[] {
  // A styled number (percent, currency, unit) is not a count; a plain one followed by a word is.
  if (!isNumberElement(el) || el.style !== null || next === undefined) return [];
  if (!isLiteralElement(next) || !/^\s+\p{L}/u.test(next.value)) return [];
  const message = `{${el.value}, number} is followed by a word: use {${el.value}, plural, one {…} other {…}}`;
  return [problem('L6', message)];
}

function checkElement(
  el: MessageFormatElement,
  next: MessageFormatElement | undefined,
  ctx: MessageContext,
): LintProblem[] {
  const problems: LintProblem[] = [];
  if (isDateElement(el) || isTimeElement(el)) {
    problems.push(problem('L3', 'no {x, date}/{x, time}: format dates in src/i18n/format-date.ts'));
  }
  if (isTagElement(el)) problems.push(problem('L3', 'no rich-text tags in messages'));
  problems.push(...checkPlaceholderName(el));
  if (isPluralElement(el)) problems.push(...checkPlural(el, ctx.language));
  if (countNeedsPlural(ctx.language, ctx.policy)) problems.push(...checkCountNeedsPlural(el, next));
  if (isLiteralElement(el)) problems.push(...checkLiteral(el.value, ctx));
  return problems;
}

export function checkKey({ key, policy }: MessageContext): LintProblem[] {
  const problems: LintProblem[] = [];
  if (!KEY_FORMAT.test(key)) {
    problems.push(problem('L1', 'key must be 2-5 dot-separated kebab-case segments'));
  }
  if (policy.keyPrefix !== null && !key.startsWith(`${policy.keyPrefix}.`)) {
    problems.push(problem('L1b', `keys of this catalog start with "${policy.keyPrefix}."`));
  }
  const owner = policy.reservedPrefixes.find((prefix) => key.startsWith(`${prefix}.`));
  if (owner !== undefined) {
    problems.push(problem('L1b', `"${owner}." is reserved for that package's catalog`));
  }
  return problems;
}

export function checkSentence({ language, message, policy }: MessageContext): LintProblem[] {
  const problems: LintProblem[] = [];
  if (message.trim() === '') problems.push(problem('L11', 'empty message'));
  if (JOINER_EDGE.test(message)) {
    const text = 'starts/ends with space or joiner: fragment of a glued sentence?';
    problems.push(problem('L11', text));
  }
  if (/ {2}/.test(message)) problems.push(problem('L11', 'double space'));
  const isCasedSource = language === policy.sourceLanguage && CASED_SCRIPTS.has(scriptOf(language));
  if (isCasedSource && /^\p{Ll}/u.test(message)) {
    problems.push(problem('L11', 'source message starts lowercase: fragment?'));
  }
  return problems;
}

export function parseMessage(message: string): MessageFormatElement[] | LintProblem {
  try {
    return parse(message, { requiresOtherClause: true, shouldParseSkeletons: true });
  } catch (error) {
    return problem('L2', `ICU syntax error: ${String(error)}`);
  }
}

function isBarePlaceholder(elements: readonly MessageFormatElement[]): boolean {
  const [only] = elements;
  if (elements.length !== 1 || only === undefined) return false;
  return !isLiteralElement(only) && !isPluralElement(only) && !isSelectElement(only);
}

export function checkElements(
  elements: readonly MessageFormatElement[],
  ctx: MessageContext,
): LintProblem[] {
  const problems: LintProblem[] = [];
  if (ctx.key.endsWith(SYSTEM_TEXT_SUFFIX) && /[{}]/.test(ctx.message)) {
    const text = 'is a system dialog text (InfoPlist.strings) but holds an ICU argument or brace';
    problems.push(problem('L13', text));
  }
  walk(elements, (el, next) => {
    problems.push(...checkElement(el, next, ctx));
  });
  if (isBarePlaceholder(elements)) {
    const text = 'message is a bare placeholder: put the whole sentence in the catalog';
    problems.push(problem('L11', text));
  }
  return problems;
}

export function lintMessage(ctx: MessageContext): LintProblem[] {
  const parsed = parseMessage(ctx.message);
  const base = [...checkKey(ctx), ...checkSentence(ctx)];
  return Array.isArray(parsed) ? [...base, ...checkElements(parsed, ctx)] : [...base, parsed];
}
