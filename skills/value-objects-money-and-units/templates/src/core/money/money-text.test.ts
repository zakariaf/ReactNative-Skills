// src/core/money/money-text.test.ts
import fc from 'fast-check';

import { CURRENCY_EXPONENTS } from './currency-exponents';
import { money } from './money';
import { parseMoney, toDecimalString } from './money-text';

import type { CurrencyCode } from './currency';

describe('money text', () => {
  it.each([
    ['1.50', 'USD', 150],
    ['1.5', 'USD', 150],
    ['125.00', 'KWD', 125_000],
    ['125', 'JPY', 125],
    ['125.00', 'JPY', 125],
    ['12.345', 'KWD', 12_345],
    ['0.001', 'OMR', 1],
    ['12.345', 'IQD', 12_345],
    ['-0.05', 'EUR', -5],
  ] as const)('reads %s %s as %i minor units', (text, currency, minor) => {
    expect(parseMoney(text, currency)).toStrictEqual({
      ok: true,
      value: money(minor, currency),
    });
  });

  it('refuses more decimals than the currency has, instead of rounding', () => {
    expect(parseMoney('1.234', 'USD')).toStrictEqual({
      ok: false,
      error: { kind: 'too-many-decimals', maxDecimals: 2 },
    });
    expect(parseMoney('125.5', 'JPY')).toStrictEqual({
      ok: false,
      error: { kind: 'too-many-decimals', maxDecimals: 0 },
    });
  });

  it('refuses text that is not canonical ASCII decimal (normalize localized input first)', () => {
    for (const text of ['12.50xyz', '1,50', '١٢', '$1', '', '1e2']) {
      expect(parseMoney(text, 'USD')).toStrictEqual({
        ok: false,
        error: { kind: 'not-a-decimal', text },
      });
    }
    expect(parseMoney('99999999999999999', 'JPY')).toStrictEqual({
      ok: false,
      error: { kind: 'out-of-range' },
    });
  });

  it('writes exact decimal text with the currency exponent', () => {
    expect(toDecimalString(money(12_345, 'KWD'))).toBe('12.345');
    expect(toDecimalString(money(-5, 'USD'))).toBe('-0.05');
    expect(toDecimalString(money(125, 'JPY'))).toBe('125');
    expect(toDecimalString(money(Number.MAX_SAFE_INTEGER, 'USD'))).toBe('90071992547409.91');
  });

  it('keeps every amount in every currency through a text round trip', () => {
    const codes = Object.keys(CURRENCY_EXPONENTS) as CurrencyCode[];
    fc.assert(
      fc.property(fc.constantFrom(...codes), fc.maxSafeInteger(), (currency, minor) => {
        const amount = money(minor, currency);
        expect(parseMoney(toDecimalString(amount), currency)).toStrictEqual({
          ok: true,
          value: amount,
        });
      }),
    );
  });
});
