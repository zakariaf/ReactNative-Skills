// src/i18n/normalize-decimal-input.ts
// What a person types into an amount or quantity field, in the app's language and digits, becomes
// canonical ASCII decimal text for the pure parsers (parseMoney, quantityFromDecimal) here, at the
// edge. The symbols come from the same locale tag the app formats with, so a field accepts what the
// app shows: '1.234,5' in German, '١٢٫٥' in Arabic with Arabic-Indic digits, '1,234.5' in English.
// A group separator counts only where it can stand (between whole groups of digits, before the
// decimal point); a lone '.' or ',' that cannot be a group separator is the decimal point a
// keyboard sent ('12.50' in German is 12.50, never 1250); a reading that could go either way
// ('1.234' in German, '1,234' in English) is a typed failure. Any other character is kept, so the parser refuses it.
import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

/** One locale's separators, grouping and digits, as Intl formats numbers in it. */
export type DecimalSymbols = {
  readonly decimal: string;
  readonly group: string;
  /** Digits in the last group (3) and in each group before it (3; 2 in en-IN's 1,23,45,678). */
  readonly primaryGroup: number;
  readonly secondaryGroup: number;
  /** Each locale digit ('٣') to its ASCII digit ('3'). */
  readonly digits: ReadonlyMap<string, string>;
};

/**
 * ambiguous-separator: '1.234' in German is 1234 with a grouping dot, or 1.234 from a keyboard that
 * has only '.'; ask the person to type it without the group separator. misplaced-separator: a group
 * separator where none can stand ('1,2,3', '1.234,5' in English).
 */
export type DecimalInputFailure = {
  readonly kind: 'ambiguous-separator' | 'misplaced-separator';
  readonly text: string;
};

const symbolsByTag = new Map<string, DecimalSymbols>();
// Bidi controls Intl puts around numbers: the right-to-left mark, the Arabic letter mark, isolates.
const BIDI = /\p{Bidi_Control}/gu;
const SPACE = /^\s$/u;
const MINUS = /^[-−]/;
const DIGITS_ONLY = /^\d+$/;
const THREE_DIGITS = /^\d{3}$/;
// A private-use character marks a group separator while the text is read.
const GROUP_MARK = '';
const APOSTROPHES = new Set(["'", '’']);
// The separators a keyboard may send as the decimal point, whatever the app's locale.
const KEYBOARD_POINTS = new Set(['.', ',']);

function partOf(parts: readonly Intl.NumberFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

/** The symbols of `localeTag`, read once from Intl (the forced polyfill on the phone and in Jest). */
export function decimalSymbolsFor(localeTag: string): DecimalSymbols {
  const cached = symbolsByTag.get(localeTag);
  if (cached !== undefined) return cached;
  const parts = new Intl.NumberFormat(localeTag).formatToParts(1_234_567_890.5);
  const sizes = parts.filter((part) => part.type === 'integer').map((part) => part.value.length);
  const plain = new Intl.NumberFormat(localeTag, { useGrouping: false });
  const digits = new Map<string, string>();
  for (let value = 0; value <= 9; value += 1) digits.set(plain.format(value), String(value));
  const created = {
    decimal: partOf(parts, 'decimal'),
    group: partOf(parts, 'group'),
    primaryGroup: sizes.at(-1) ?? 3,
    secondaryGroup: sizes.length > 2 ? (sizes.at(-2) ?? 3) : 3,
    digits,
  };
  symbolsByTag.set(localeTag, created);
  return created;
}

function isGroupCharacter(character: string, group: string): boolean {
  if (character === group) return true;
  if (SPACE.test(group)) return SPACE.test(character);
  return APOSTROPHES.has(group) && APOSTROPHES.has(character);
}

function mapCharacter(character: string, symbols: DecimalSymbols): string {
  if (character >= '0' && character <= '9') return character;
  const digit = symbols.digits.get(character);
  if (digit !== undefined) return digit;
  if (character === symbols.decimal) return '.';
  if (symbols.group !== '' && isGroupCharacter(character, symbols.group)) return GROUP_MARK;
  // Anything else stays. A '.' that is not this locale's group separator is then the decimal point
  // a keyboard without the locale's decimal key sent; other characters make the parser refuse.
  return character;
}

/** '12' then '345' then '678' (or '1', '23', '456' in en-IN): whole groups of the locale's sizes. */
function isWellGrouped(groups: readonly string[], symbols: DecimalSymbols): boolean {
  const first = groups[0] ?? '';
  const middle = groups.slice(1, -1);
  const last = groups.at(-1) ?? '';
  return (
    groups.every((group) => DIGITS_ONLY.test(group)) &&
    first.length <= symbols.secondaryGroup &&
    middle.every((group) => group.length === symbols.secondaryGroup) &&
    last.length === symbols.primaryGroup
  );
}

/**
 * A lone '.' or ',' between digits: a decimal point a keyboard sent ('12.50', '1.5'), unless it could
 * also be a group separator before exactly three digits ('1.234', '12,345'): then only the person
 * knows which they meant.
 */
function readLoneSeparator(groups: readonly string[]): Result<string, DecimalInputFailure['kind']> {
  const first = groups[0] ?? '';
  const last = groups[1] ?? '';
  const canBeGrouping = DIGITS_ONLY.test(first) && first.length <= 3 && THREE_DIGITS.test(last);
  return canBeGrouping ? err('ambiguous-separator') : ok(`${first}.${last}`);
}

/** Drops well-placed group marks; reads a lone keyboard separator through readLoneSeparator. */
function readGroups(
  body: string,
  symbols: DecimalSymbols,
): Result<string, DecimalInputFailure['kind']> {
  if (!body.includes(GROUP_MARK)) return ok(body);
  const point = body.indexOf('.');
  const whole = point === -1 ? body : body.slice(0, point);
  const fraction = point === -1 ? '' : body.slice(point);
  const groups = whole.split(GROUP_MARK);
  if (point === -1 && groups.length === 2 && KEYBOARD_POINTS.has(symbols.group)) {
    return readLoneSeparator(groups);
  }
  const isWellPlaced = !fraction.includes(GROUP_MARK) && isWellGrouped(groups, symbols);
  return isWellPlaced ? ok(groups.join('') + fraction) : err('misplaced-separator');
}

/**
 * The same as normalizeDecimalInput with the symbols given, for a locale whose Intl data the app
 * does not load (and for tests): normalizeDecimalText('12.50', germanSymbols) -> ok('12.50').
 */
export function normalizeDecimalText(
  text: string,
  symbols: DecimalSymbols,
): Result<string, DecimalInputFailure> {
  const compact = text.replace(BIDI, '').trim();
  const isNegative = MINUS.test(compact);
  let body = '';
  for (const character of compact.replace(MINUS, '')) body += mapCharacter(character, symbols);
  const read = readGroups(body, symbols);
  if (!read.ok) return err({ kind: read.error, text });
  const withWhole = read.value.startsWith('.') ? `0${read.value}` : read.value;
  const trimmed = withWhole.endsWith('.') ? withWhole.slice(0, -1) : withWhole;
  return ok(isNegative ? `-${trimmed}` : trimmed);
}

/**
 * '١٢٫٥' (ar-u-nu-arab) -> ok('12.5'); '1,234.50' (en) -> ok('1234.50'); '12,5' (en) -> ok('12.5');
 * '.5' -> ok('0.5'); '−3' -> ok('-3'); '1,234' (en) -> ambiguous-separator; '1,2,3' (en) ->
 * misplaced-separator. Feed the ok text to parseMoney / quantityFromDecimal.
 */
export function normalizeDecimalInput(
  text: string,
  localeTag: string,
): Result<string, DecimalInputFailure> {
  return normalizeDecimalText(text, decimalSymbolsFor(localeTag));
}
