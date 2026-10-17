// src/core/rng/seeded-draws.test.ts
// Pinned draws were computed by an independent oracle (Python integers, written from the documented
// draw order); the properties hold for any seed.
import fc from 'fast-check';

import { drawOne, drawSample, shuffle } from './seeded-draws';
import { nextInt, seedRng } from './sfc32';

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

describe('seeded draws', () => {
  it('pins the draws for seed 42 (the documented draw order)', () => {
    expect(drawOne(LETTERS, seedRng(42)).value).toBe('h');
    expect(shuffle(LETTERS, seedRng(42)).value).toStrictEqual([
      'f',
      'b',
      'd',
      'e',
      'a',
      'c',
      'g',
      'h',
    ]);
    expect(drawSample(LETTERS, 3, seedRng(42)).value).toStrictEqual(['h', 'a', 'e']);
  });

  it('consumes exactly one draw for drawOne and count draws for drawSample', () => {
    const start = seedRng(7);
    expect(drawOne(LETTERS, start).state).toStrictEqual(nextInt(start, 8).state);
    const afterThree = [8, 7, 6].reduce((state, max) => nextInt(state, max).state, start);
    expect(drawSample(LETTERS, 3, start).state).toStrictEqual(afterThree);
    const afterAll = [8, 7, 6, 5, 4, 3, 2, 1].reduce(
      (state, max) => nextInt(state, max).state,
      start,
    );
    expect(drawSample(LETTERS, 8, start).state).toStrictEqual(afterAll);
  });

  it('returns a permutation and leaves the input unchanged', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.integer(), { maxLength: 30 }), (seed, items) => {
        const copy = [...items];
        const { value } = shuffle(items, seedRng(seed));
        expect([...value].sort((x, y) => x - y)).toStrictEqual([...items].sort((x, y) => x - y));
        expect(items).toStrictEqual(copy);
      }),
      { seed: 21, numRuns: 300 },
    );
  });

  it('returns count distinct items from the list', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 8 }), (seed, count) => {
        const { value } = drawSample(LETTERS, count, seedRng(seed));
        expect(value).toHaveLength(count);
        expect(new Set(value).size).toBe(count);
      }),
      { seed: 22, numRuns: 300 },
    );
  });

  it('throws on an empty list or an impossible count', () => {
    expect(() => drawOne([], seedRng(1))).toThrow(RangeError);
    expect(() => drawSample(LETTERS, 9, seedRng(1))).toThrow('outside 0..8');
    expect(() => drawSample(LETTERS, 1.5, seedRng(1))).toThrow(RangeError);
  });
});
