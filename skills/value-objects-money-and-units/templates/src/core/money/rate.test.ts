// src/core/money/rate.test.ts
import { money, subtractMoney } from './money';
import {
  applyRate,
  basisPoints,
  convertMoney,
  includedTax,
  parseDecimalRate,
  parsePercent,
} from './rate';

describe('rates', () => {
  it('parses percent and decimal text into exact ratios', () => {
    expect(parsePercent('8.25')).toStrictEqual({
      ok: true,
      value: { numerator: 825, denominator: 10_000 },
    });
    expect(parsePercent('19')).toStrictEqual({
      ok: true,
      value: { numerator: 19, denominator: 100 },
    });
    expect(parseDecimalRate('1.0834')).toStrictEqual({
      ok: true,
      value: { numerator: 10_834, denominator: 10_000 },
    });
    expect(parsePercent('8,25')).toStrictEqual({
      ok: false,
      error: { kind: 'not-a-rate', text: '8,25' },
    });
    expect(parseDecimalRate('0.1e1')).toStrictEqual({
      ok: false,
      error: { kind: 'not-a-rate', text: '0.1e1' },
    });
    expect(basisPoints(825)).toStrictEqual({
      numerator: 825,
      denominator: 10_000,
    });
    expect(() => basisPoints(8.25)).toThrow(RangeError);
  });

  it('applies a rate once, with the rounding mode the caller names', () => {
    const subtotal = money(1005, 'EUR');
    const vat = { numerator: 19, denominator: 100 };
    expect(applyRate(subtotal, vat, 'half-even')).toStrictEqual(money(191, 'EUR'));
    expect(applyRate(money(250, 'USD'), basisPoints(1000), 'half-even')).toStrictEqual(
      money(25, 'USD'),
    );
    // 12.5 cents: a tie. Half-even keeps 12, half-expand gives 13, floor 12, ceil 13.
    const tie = money(125, 'USD');
    expect(applyRate(tie, basisPoints(1000), 'half-even')).toStrictEqual(money(12, 'USD'));
    expect(applyRate(tie, basisPoints(1000), 'half-expand')).toStrictEqual(money(13, 'USD'));
    expect(applyRate(money(-125, 'USD'), basisPoints(1000), 'half-expand')).toStrictEqual(
      money(-13, 'USD'),
    );
  });

  it('extracts the tax inside a tax-inclusive price so net + tax is the gross', () => {
    const gross = money(1190, 'EUR');
    const tax = includedTax(gross, { numerator: 19, denominator: 100 }, 'half-even');
    expect(tax).toStrictEqual(money(190, 'EUR'));
    expect(subtractMoney(gross, tax)).toStrictEqual(money(1000, 'EUR'));
    expect(
      includedTax(money(999, 'EUR'), { numerator: 7, denominator: 100 }, 'half-even'),
    ).toStrictEqual(money(65, 'EUR'));
  });

  it('converts between currencies with different exponents in one exact step', () => {
    const perUnit = { numerator: 67, denominator: 10_000 };
    expect(convertMoney(money(1000, 'JPY'), { to: 'USD', perUnit }, 'half-even')).toStrictEqual(
      money(670, 'USD'),
    );
    const kwdPerUsd = { numerator: 3074, denominator: 10_000 };
    expect(
      convertMoney(money(1999, 'USD'), { to: 'KWD', perUnit: kwdPerUsd }, 'half-even'),
    ).toStrictEqual(money(6145, 'KWD'));
  });

  it('refuses a rate that is not a ratio of whole numbers', () => {
    expect(() => applyRate(money(1, 'USD'), { numerator: 0.19, denominator: 1 }, 'trunc')).toThrow(
      RangeError,
    );
    expect(() => applyRate(money(1, 'USD'), { numerator: 1, denominator: 0 }, 'trunc')).toThrow(
      RangeError,
    );
  });
});
