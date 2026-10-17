// src/i18n/create-number-formatter.test.ts
// The digits follow the locale tag, not the device: the forced FormatJS polyfill (Jest setupFiles,
// like the app entry) honours -u-nu-. Expected strings are written with escapes where CLDR puts
// invisible marks into the output (Arabic percent signs carry U+061C or U+200E).
import { createNumberFormatter, createPercentFormatter } from './create-number-formatter';
import { localeTagFor } from './digits';

describe('createNumberFormatter', () => {
  it.each([
    ['en', 'automatic', '1,234,568'],
    ['ar', 'automatic', '١٬٢٣٤٬٥٦٨'],
    ['ar', 'local', '١٬٢٣٤٬٥٦٨'],
    ['ar', 'latin', '1,234,568'],
  ] as const)('formats 1234567.89 in %s with %s digits as %s', (language, digits, expected) => {
    expect(createNumberFormatter(localeTagFor(language, digits))(1234567.89)).toBe(expected);
  });

  it('uses Arabic-Indic digits for a plain count in Arabic', () => {
    expect(createNumberFormatter(localeTagFor('ar', 'automatic'))(3)).toBe('٣');
  });
});

describe('createPercentFormatter', () => {
  it.each([
    ['en', 'automatic', '62%'],
    ['ar', 'automatic', '٦٢\u066A\u061C'],
    ['ar', 'latin', '62\u200E%\u200E'],
  ] as const)('shows a 0.62 rate in %s with %s digits as %j', (language, digits, expected) => {
    expect(createPercentFormatter(localeTagFor(language, digits))(0.62)).toBe(expected);
  });

  it('rounds to a whole percentage', () => {
    expect(createPercentFormatter('en')(0.6249)).toBe('62%');
    expect(createPercentFormatter('en')(1)).toBe('100%');
  });
});
