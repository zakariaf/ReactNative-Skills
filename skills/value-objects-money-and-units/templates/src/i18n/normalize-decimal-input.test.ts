// src/i18n/normalize-decimal-input.test.ts
import { parseMoney } from '@/core/money/money-text';
import { err, ok } from '@/core/result';

import {
  decimalSymbolsFor,
  normalizeDecimalInput,
  normalizeDecimalText,
} from './normalize-decimal-input';

import type { DecimalSymbols } from './normalize-decimal-input';

// Locales whose Intl data the app may not load: their symbols written out, as Intl gives them.
const latinDigits = new Map(
  Array.from({ length: 10 }, (_, digit) => [String(digit), String(digit)]),
);
const symbolsOf = (decimal: string, group: string, secondaryGroup = 3): DecimalSymbols => ({
  decimal,
  group,
  primaryGroup: 3,
  secondaryGroup,
  digits: latinDigits,
});
const GERMAN = symbolsOf(',', '.');
const SWISS = symbolsOf('.', '’');
const FRENCH = symbolsOf(',', ' ');
const INDIAN = symbolsOf('.', ',', 2);

describe('normalizeDecimalInput with the app locale tag', () => {
  it.each([
    ['12.5', 'en', '12.5'],
    ['1,234.50', 'en', '1234.50'],
    ['1,234,567', 'en', '1234567'],
    [' 7.25 ', 'en', '7.25'],
    ['.5', 'en', '0.5'],
    ['5.', 'en', '5'],
    ['−3', 'en', '-3'],
    ['-3.5', 'en', '-3.5'],
    ['12,5', 'en', '12.5'],
    ['1,5', 'en', '1.5'],
    ['1234,567', 'en', '1234.567'],
    ['١٢٫٥', 'ar-u-nu-arab', '12.5'],
    ['١٬٢٣٤٫٥', 'ar-u-nu-arab', '1234.5'],
    ['١٬٢٣٤', 'ar-u-nu-arab', '1234'],
    ['12.5', 'ar-u-nu-arab', '12.5'],
    ['‏١٩٫٩٩', 'ar-u-nu-arab', '19.99'],
  ])('turns %j in %s into %j', (text, tag, expected) => {
    expect(normalizeDecimalInput(text, tag)).toStrictEqual(ok(expected));
  });

  it.each([
    ['1,234', 'ambiguous-separator'],
    ['1,2,3', 'misplaced-separator'],
    ['12,34.5', 'misplaced-separator'],
    ['1.234,5', 'misplaced-separator'],
  ] as const)('refuses %j in en: %s', (text, kind) => {
    expect(normalizeDecimalInput(text, 'en')).toStrictEqual(err({ kind, text }));
  });

  it('keeps what it does not understand, so the parser refuses it', () => {
    expect(normalizeDecimalInput('12,5', 'ar-u-nu-arab')).toStrictEqual(ok('12,5'));
    expect(normalizeDecimalInput('$12', 'en')).toStrictEqual(ok('$12'));
    expect(normalizeDecimalInput('1 234', 'en')).toStrictEqual(ok('1 234'));
    for (const text of ['12,5', '$12', '12abc', '1 234']) {
      const normalized = normalizeDecimalInput(text, text === '12,5' ? 'ar-u-nu-arab' : 'en');
      expect(normalized.ok && parseMoney(normalized.value, 'USD').ok).toBe(false);
    }
  });

  it('reads the separators, grouping and digits from Intl', () => {
    expect(decimalSymbolsFor('en')).toMatchObject({
      decimal: '.',
      group: ',',
      primaryGroup: 3,
      secondaryGroup: 3,
    });
    expect(decimalSymbolsFor('ar-u-nu-arab').digits.get('٣')).toBe('3');
  });

  it('feeds parseMoney exact text from localized input', () => {
    const typed = normalizeDecimalInput('١٢٫٣٤٥', 'ar-u-nu-arab');
    expect(typed.ok && parseMoney(typed.value, 'KWD')).toStrictEqual(parseMoney('12.345', 'KWD'));
  });
});

describe('normalizeDecimalText with written-out symbols', () => {
  it.each([
    ['12.50', GERMAN, '12.50'],
    ['1.5', GERMAN, '1.5'],
    ['1.234,5', GERMAN, '1234.5'],
    ['1.234.567', GERMAN, '1234567'],
    ['12,50', GERMAN, '12.50'],
    ['.5', GERMAN, '0.5'],
    ["1'234.50", SWISS, '1234.50'],
    ['1’234', SWISS, '1234'],
    ['1 234,5', FRENCH, '1234.5'],
    ['1 234', FRENCH, '1234'],
    ['12.5', FRENCH, '12.5'],
    ['1,23,456.75', INDIAN, '123456.75'],
    ['12,345.5', INDIAN, '12345.5'],
  ])('turns %j into %j', (text, symbols, expected) => {
    expect(normalizeDecimalText(text, symbols)).toStrictEqual(ok(expected));
  });

  it.each([
    ['1.234', GERMAN, 'ambiguous-separator'],
    ['1.23.4', GERMAN, 'misplaced-separator'],
    ['1,5.25', GERMAN, 'misplaced-separator'],
    ['12 5', FRENCH, 'misplaced-separator'],
    ['12,345', INDIAN, 'ambiguous-separator'],
    ['123,456', INDIAN, 'ambiguous-separator'],
    ['1,23,4567', INDIAN, 'misplaced-separator'],
  ] as const)('refuses %j: %s', (text, symbols, kind) => {
    expect(normalizeDecimalText(text, symbols)).toStrictEqual(err({ kind, text }));
  });

  it('keeps a German keyboard dot a decimal point, never a bigger amount', () => {
    const typed = normalizeDecimalText('12.50', GERMAN);
    expect(typed.ok && parseMoney(typed.value, 'EUR')).toStrictEqual(parseMoney('12.50', 'EUR'));
  });
});
