// src/i18n/format-money.test.ts
// Jest loads the forced FormatJS polyfills (jest setupFiles), so these strings are what iOS and
// Android show. U+200F is the right-to-left mark Arabic currency formats start with; U+00A0 is a
// no-break space.
import { money } from '@/core/money/money';

import { formatMoney } from './format-money';

describe('formatMoney', () => {
  it('formats with the ISO 4217 exponent, not CLDR display digits', () => {
    expect(formatMoney(money(1999, 'USD'), 'en')).toBe('$19.99');
    expect(formatMoney(money(12_345, 'KWD'), 'en')).toBe('KWD 12.345');
    expect(formatMoney(money(125, 'JPY'), 'en')).toBe('¥125');
    // CLDR shows IQD with 0 decimals; ISO 4217 has 3, so 12345 minor units are 12.345 IQD.
    expect(formatMoney(money(12_345, 'IQD'), 'en')).toBe('IQD 12.345');
  });

  it('formats exactly at any size and sign', () => {
    expect(formatMoney(money(Number.MAX_SAFE_INTEGER, 'USD'), 'en')).toBe('$90,071,992,547,409.91');
    expect(formatMoney(money(-5, 'USD'), 'en')).toBe('-$0.05');
    expect(formatMoney(money(-1234, 'USD'), 'en', { isAccounting: true })).toBe('($12.34)');
  });

  it('shows the code, the name or the narrow symbol on request', () => {
    expect(formatMoney(money(199, 'EUR'), 'en', { display: 'code' })).toBe('EUR 1.99');
    expect(formatMoney(money(199, 'USD'), 'en', { display: 'name' })).toBe('1.99 US dollars');
    expect(formatMoney(money(199, 'USD'), 'en', { display: 'narrow-symbol' })).toBe('$1.99');
  });

  it('uses the digits the locale tag carries', () => {
    expect(formatMoney(money(1999, 'USD'), 'ar-u-nu-arab')).toBe('‏١٩٫٩٩ US$');
    expect(formatMoney(money(1999, 'USD'), 'ar-u-nu-latn')).toBe('‏19.99 US$');
  });
});
