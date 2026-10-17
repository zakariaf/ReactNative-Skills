// src/core/decimal/decimal.test.ts
import fc from 'fast-check';

import { formatScaled, parseDecimal, pow10, rescaleExact } from './decimal';

describe('decimal text', () => {
  it('parses canonical ASCII decimals into units and a scale', () => {
    expect(parseDecimal('12.345')).toStrictEqual({
      units: BigInt(12_345),
      scale: 3,
    });
    expect(parseDecimal('-0.05')).toStrictEqual({
      units: BigInt(-5),
      scale: 2,
    });
    expect(parseDecimal('125')).toStrictEqual({ units: BigInt(125), scale: 0 });
    expect(parseDecimal('007.50')).toStrictEqual({
      units: BigInt(750),
      scale: 2,
    });
  });

  it('refuses everything that is not canonical ASCII decimal text', () => {
    for (const text of [
      '',
      '.5',
      '5.',
      '1e3',
      '12.50xyz',
      '+1',
      '1,5',
      '١٢',
      ' 1',
      '0x10',
      '--1',
    ]) {
      expect(parseDecimal(text)).toBeNull();
    }
  });

  it('rescales only when no digit is lost', () => {
    const value = { units: BigInt(1230), scale: 3 };
    expect(rescaleExact(value, 2)).toBe(BigInt(123));
    expect(rescaleExact(value, 5)).toBe(BigInt(123_000));
    expect(rescaleExact({ units: BigInt(1234), scale: 3 }, 2)).toBeNull();
  });

  it('formats scaled units with exactly the scale', () => {
    expect(formatScaled(BigInt(12_345), 3)).toBe('12.345');
    expect(formatScaled(BigInt(-5), 2)).toBe('-0.05');
    expect(formatScaled(BigInt(125), 0)).toBe('125');
    expect(formatScaled(BigInt(0), 2)).toBe('0.00');
  });

  it('keeps any integer at any scale through a text round trip', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(-1e15), max: BigInt(1e15) }),
        fc.nat(6),
        (units, scale) => {
          expect(parseDecimal(formatScaled(units, scale))).toStrictEqual({
            units,
            scale,
          });
        },
      ),
    );
  });

  it('refuses a negative or fractional power of ten', () => {
    expect(pow10(3)).toBe(BigInt(1000));
    expect(() => pow10(-1)).toThrow(RangeError);
    expect(() => pow10(1.5)).toThrow(RangeError);
  });
});
