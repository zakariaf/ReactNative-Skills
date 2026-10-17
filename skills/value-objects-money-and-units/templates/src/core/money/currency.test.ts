// src/core/money/currency.test.ts
import { exponentOf, isCurrencyCode, parseCurrencyCode } from './currency';
import { CURRENCY_EXPONENTS } from './currency-exponents';

describe('currency codes', () => {
  it('uses the ISO 4217 exponent, including where CLDR display digits differ', () => {
    expect(exponentOf('JPY')).toBe(0);
    expect(exponentOf('USD')).toBe(2);
    expect(exponentOf('KWD')).toBe(3);
    expect(exponentOf('CLF')).toBe(4);
    expect(exponentOf('IQD')).toBe(3);
    expect(exponentOf('HUF')).toBe(2);
  });

  it('turns a known code into a CurrencyCode and an unknown one into a failure', () => {
    expect(parseCurrencyCode('EUR')).toStrictEqual({ ok: true, value: 'EUR' });
    for (const code of ['ZZZ', 'usd', 'XAU', 'XXX', 'toString', '']) {
      expect(parseCurrencyCode(code)).toStrictEqual({
        ok: false,
        error: { kind: 'unknown-currency', code },
      });
    }
  });

  it('holds only three-letter codes with an exponent of 0, 2, 3 or 4', () => {
    for (const [code, exponent] of Object.entries(CURRENCY_EXPONENTS)) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3, 4]).toContain(exponent);
      expect(isCurrencyCode(code)).toBe(true);
    }
  });
});
