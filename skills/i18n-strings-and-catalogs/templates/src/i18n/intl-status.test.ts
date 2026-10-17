// src/i18n/intl-status.test.ts
import { areIntlPolyfillsActive } from './intl-status';

describe('areIntlPolyfillsActive', () => {
  it('is true in Jest, because setupFiles loads the forced polyfills first', () => {
    expect(areIntlPolyfillsActive()).toBe(true);
  });

  it('formats Arabic numbers with Arabic-Indic digits and separators, as on the phone', () => {
    expect(new Intl.NumberFormat('ar-u-nu-arab').format(1234.5)).toBe('١٬٢٣٤٫٥');
  });

  it('gives Arabic six plural categories (why each language lists its own)', () => {
    const rules = new Intl.PluralRules('ar');
    expect([0, 1, 2, 3, 11, 100].map((count) => rules.select(count))).toStrictEqual([
      'zero',
      'one',
      'two',
      'few',
      'many',
      'other',
    ]);
  });
});
