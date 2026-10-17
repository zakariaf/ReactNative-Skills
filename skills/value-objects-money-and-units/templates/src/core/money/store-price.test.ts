// src/core/money/store-price.test.ts
// 1.9899999999999998 is how StoreKit's 1.99 arrives through a JS number (seen on an iOS simulator
// with a StoreKit configuration); Play Billing reports micros as an integer string.
import { money } from './money';
import { moneyFromMicros, moneyFromStoreDouble } from './store-price';

describe('store prices', () => {
  it('takes micros exactly', () => {
    expect(moneyFromMicros('1990000', 'EUR')).toStrictEqual({
      ok: true,
      value: money(199, 'EUR'),
    });
    expect(moneyFromMicros('120000000', 'JPY')).toStrictEqual({
      ok: true,
      value: money(120, 'JPY'),
    });
    expect(moneyFromMicros('12345000', 'KWD')).toStrictEqual({
      ok: true,
      value: money(12_345, 'KWD'),
    });
    expect(moneyFromMicros('1995000', 'EUR')).toStrictEqual({
      ok: false,
      error: { kind: 'too-many-decimals', maxDecimals: 2 },
    });
    expect(moneyFromMicros('1.99', 'EUR')).toStrictEqual({
      ok: false,
      error: { kind: 'not-a-decimal', text: '1.99' },
    });
    expect(moneyFromMicros(`${'9'.repeat(26)}0000`, 'EUR')).toStrictEqual({
      ok: false,
      error: { kind: 'out-of-range' },
    });
  });

  it('takes a store double to the nearest minor unit when it is only double noise', () => {
    expect(moneyFromStoreDouble(1.9899999999999998, 'EUR')).toStrictEqual({
      ok: true,
      value: money(199, 'EUR'),
    });
    expect(moneyFromStoreDouble(0.29, 'USD')).toStrictEqual({
      ok: true,
      value: money(29, 'USD'),
    });
    expect(moneyFromStoreDouble(1200, 'JPY')).toStrictEqual({
      ok: true,
      value: money(1200, 'JPY'),
    });
    expect(moneyFromStoreDouble(12.345, 'KWD')).toStrictEqual({
      ok: true,
      value: money(12_345, 'KWD'),
    });
  });

  it('refuses a double with real extra digits, NaN or an unsafe value', () => {
    expect(moneyFromStoreDouble(1.999, 'USD')).toStrictEqual({
      ok: false,
      error: { kind: 'too-many-decimals', maxDecimals: 2 },
    });
    expect(moneyFromStoreDouble(Number.NaN, 'USD')).toStrictEqual({
      ok: false,
      error: { kind: 'not-a-decimal', text: 'NaN' },
    });
    expect(moneyFromStoreDouble(1e20, 'USD')).toStrictEqual({
      ok: false,
      error: { kind: 'out-of-range' },
    });
  });
});
