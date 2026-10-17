// src/core/money/allocate.test.ts
// The pinned vectors were computed by hand with the largest-remainder rule (floors first, then one
// minor unit each to the largest remainders, ties to the lower index); the properties hold for any input.
import fc from 'fast-check';

import { allocate, allocateMinor, splitEvenly } from './allocate';
import { money } from './money';

const sum = (parts: readonly number[]): number => parts.reduce((total, part) => total + part, 0);

describe('allocate', () => {
  it.each([
    [1001, [1, 1, 1], [334, 334, 333]],
    [660, [1584, 4033, 1933], [138, 353, 169]],
    [1510, [1584, 4033, 1933], [317, 807, 386]],
    [100, [1, 2, 3], [17, 33, 50]],
    [999, [333, 333, 334], [333, 333, 333]],
    [5, [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 0, 0]],
    [-1001, [1, 1, 1], [-334, -334, -333]],
    [90, [0, 0, 0], [30, 30, 30]],
    [10, [0, 1], [0, 10]],
    [0, [3, 4], [0, 0]],
  ])('splits %i by %j into %j', (amount, weights, expected) => {
    expect(allocateMinor(amount, weights)).toStrictEqual(expected);
  });

  it('always sums to the whole, mirrors negatives and is deterministic', () => {
    const weight = fc.integer({ min: 0, max: 1_000_000 });
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.array(weight, { minLength: 1, maxLength: 12 }),
        (amount, weights) => {
          const parts = allocateMinor(amount, weights);
          expect(parts).toHaveLength(weights.length);
          expect(sum(parts)).toBe(amount);
          expect(allocateMinor(-amount, weights)).toStrictEqual(parts.map((part) => -part + 0));
          expect(allocateMinor(amount, weights)).toStrictEqual(parts);
        },
      ),
    );
  });

  it('keeps every part within one minor unit of its exact share', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (amount, weights) => {
          const total = sum(weights);
          allocateMinor(amount, weights).forEach((part, index) => {
            expect(Math.abs(part - (amount * (weights[index] ?? 0)) / total)).toBeLessThan(1);
          });
        },
      ),
    );
  });

  it('refuses inputs that would lose or invent money', () => {
    expect(() => allocateMinor(100, [])).toThrow(RangeError);
    expect(() => allocateMinor(100, [1, -1])).toThrow(RangeError);
    expect(() => allocateMinor(100, [0.5, 1])).toThrow(RangeError);
    expect(() => allocateMinor(10.5, [1, 1])).toThrow(RangeError);
  });

  it('splits Money in its own currency', () => {
    expect(allocate(money(1001, 'USD'), [1, 1, 1])).toStrictEqual([
      money(334, 'USD'),
      money(334, 'USD'),
      money(333, 'USD'),
    ]);
    expect(splitEvenly(money(100, 'JPY'), 3)).toStrictEqual([
      money(34, 'JPY'),
      money(33, 'JPY'),
      money(33, 'JPY'),
    ]);
    expect(() => splitEvenly(money(100, 'JPY'), 0)).toThrow(RangeError);
  });
});
