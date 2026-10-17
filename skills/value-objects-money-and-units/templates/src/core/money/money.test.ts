// src/core/money/money.test.ts
import {
  addMoney,
  compareMoney,
  equalsMoney,
  money,
  multiplyMoney,
  negateMoney,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from './money';

describe('Money', () => {
  it('holds whole minor units and refuses anything else', () => {
    expect(money(12_345, 'KWD')).toStrictEqual({
      minor: 12_345,
      currency: 'KWD',
    });
    for (const minor of [1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => money(minor, 'USD')).toThrow(RangeError);
    }
    expect(Object.is(money(-0, 'USD').minor, 0)).toBe(true);
    expect(Object.isFrozen(money(1, 'USD'))).toBe(true);
  });

  it('adds, subtracts, negates and multiplies within one currency', () => {
    const price = money(499, 'USD');
    expect(addMoney(price, money(1, 'USD'))).toStrictEqual(money(500, 'USD'));
    expect(subtractMoney(price, money(500, 'USD'))).toStrictEqual(money(-1, 'USD'));
    expect(negateMoney(price)).toStrictEqual(money(-499, 'USD'));
    expect(multiplyMoney(price, 3)).toStrictEqual(money(1497, 'USD'));
    expect(() => multiplyMoney(price, 1.5)).toThrow(RangeError);
  });

  it('throws on arithmetic or comparison across currencies', () => {
    expect(() => addMoney(money(1, 'USD'), money(1, 'EUR'))).toThrow(/Currency mismatch/);
    expect(() => subtractMoney(money(1, 'USD'), money(1, 'EUR'))).toThrow(RangeError);
    expect(() => compareMoney(money(1, 'USD'), money(1, 'EUR'))).toThrow(RangeError);
  });

  it('throws instead of losing precision past the safe integer range', () => {
    const max = money(Number.MAX_SAFE_INTEGER, 'JPY');
    expect(() => addMoney(max, money(1, 'JPY'))).toThrow(RangeError);
  });

  it('sums a list, and an empty list is zero in the given currency', () => {
    const items = [money(199, 'EUR'), money(1, 'EUR'), money(300, 'EUR')];
    expect(sumMoney(items, 'EUR')).toStrictEqual(money(500, 'EUR'));
    expect(sumMoney([], 'EUR')).toStrictEqual(zeroMoney('EUR'));
    expect(() => sumMoney(items, 'USD')).toThrow(RangeError);
  });

  it('compares and tests equality by value', () => {
    expect(compareMoney(money(1, 'USD'), money(2, 'USD'))).toBe(-1);
    expect(compareMoney(money(2, 'USD'), money(2, 'USD'))).toBe(0);
    expect(compareMoney(money(3, 'USD'), money(2, 'USD'))).toBe(1);
    expect(equalsMoney(money(2, 'USD'), money(2, 'USD'))).toBe(true);
    expect(equalsMoney(money(2, 'USD'), money(2, 'EUR'))).toBe(false);
  });
});
