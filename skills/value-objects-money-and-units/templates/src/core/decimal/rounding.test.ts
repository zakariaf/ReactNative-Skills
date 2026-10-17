// src/core/decimal/rounding.test.ts
import { divideRounded, toSafeInteger } from './rounding';

import type { RoundingMode } from './rounding';

const big = (value: number): bigint => BigInt(value);

// numerator / denominator -> expected per mode, for the cases that differ.
const TABLE: readonly (readonly [number, number, Readonly<Record<RoundingMode, number>>])[] = [
  [25, 10, { 'half-even': 2, 'half-expand': 3, floor: 2, ceil: 3, trunc: 2 }],
  [35, 10, { 'half-even': 4, 'half-expand': 4, floor: 3, ceil: 4, trunc: 3 }],
  [-25, 10, { 'half-even': -2, 'half-expand': -3, floor: -3, ceil: -2, trunc: -2 }],
  [-35, 10, { 'half-even': -4, 'half-expand': -4, floor: -4, ceil: -3, trunc: -3 }],
  [26, 10, { 'half-even': 3, 'half-expand': 3, floor: 2, ceil: 3, trunc: 2 }],
  [24, 10, { 'half-even': 2, 'half-expand': 2, floor: 2, ceil: 3, trunc: 2 }],
  [-26, 10, { 'half-even': -3, 'half-expand': -3, floor: -3, ceil: -2, trunc: -2 }],
  [30, 10, { 'half-even': 3, 'half-expand': 3, floor: 3, ceil: 3, trunc: 3 }],
];

describe('divideRounded', () => {
  it.each(TABLE)('rounds %i / %i by every mode', (numerator, denominator, expected) => {
    for (const [mode, value] of Object.entries(expected)) {
      expect(divideRounded(big(numerator), big(denominator), mode as RoundingMode)).toBe(
        big(value),
      );
    }
  });

  it('stays exact far beyond the safe integer range', () => {
    const huge = BigInt('123456789012345678901234567890');
    expect(divideRounded(huge * big(3) + big(1), big(3), 'ceil')).toBe(huge + big(1));
  });

  it('refuses a zero or negative denominator', () => {
    expect(() => divideRounded(big(1), big(0), 'trunc')).toThrow(RangeError);
    expect(() => divideRounded(big(1), big(-2), 'trunc')).toThrow(RangeError);
  });

  it('converts back to a number only inside the safe range', () => {
    expect(toSafeInteger(big(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => toSafeInteger(big(Number.MAX_SAFE_INTEGER) + big(1))).toThrow(RangeError);
  });
});
