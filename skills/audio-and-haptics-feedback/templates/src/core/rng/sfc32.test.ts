// src/core/rng/sfc32.test.ts
// Golden values computed by an independent oracle (Python integers, written from the PractRand
// and murmur3 descriptions); seeded-determinism-and-golden-vectors documents the procedure.
// Every value below is a compatibility contract: a diff means every seeded output changed.
import fc from 'fast-check';

import { hashSeed, hashU32, mix32, nextInt, nextU32, nextUnit, seedRng } from './sfc32';

import type { RngState } from './sfc32';

const GOLDEN_SEED_1 = [1828152527, 3394835397, 2967886022, 2251045104, 4148684523];
const GOLDEN_RAW_1234 = [7, 34, 56623200, 188882296, 3431242869];
const GOLDEN_TEXT_HASH = 2847463752; // hashSeed('tasks:2026-09-26')
const GOLDEN_MIX_1 = 1364076727;
const GOLDEN_HASH_7_3 = 2535364964;
const GOLDEN_INT_42 = [3, 4, 2, 0, 4, 0, 1, 2]; // nextInt(…, 6) eight times from seedRng(42)
const GOLDEN_UNIT_3 = 0.4118875162675977;

function drawMany(state: RngState, count: number): number[] {
  const values: number[] = [];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const draw = nextU32(current);
    values.push(draw.value);
    current = draw.state;
  }
  return values;
}

function intsMany(state: RngState, maxExclusive: number, count: number): number[] {
  const values: number[] = [];
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const draw = nextInt(current, maxExclusive);
    values.push(draw.value);
    current = draw.state;
  }
  return values;
}

/** A second transcription of PractRand's C sfc32 in another style (unsigned >>> 0 sums). */
function referenceSfc32(seed: readonly number[], count: number): number[] {
  let [a = 0, b = 0, c = 0, d = 0] = seed;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const tmp = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((((c << 21) | (c >>> 11)) >>> 0) + tmp) >>> 0;
    out.push(tmp);
  }
  return out;
}

describe('sfc32', () => {
  it('matches the PractRand reference algorithm', () => {
    const state: RngState = [1, 2, 3, 4];
    expect(drawMany(state, 50)).toStrictEqual(referenceSfc32(state, 50));
    expect(drawMany(state, 5)).toStrictEqual(GOLDEN_RAW_1234);
  });

  it('keeps the pinned golden sequence for seed 1', () => {
    expect(drawMany(seedRng(1), 5)).toStrictEqual(GOLDEN_SEED_1);
  });

  it('keeps the pinned nextInt, nextUnit, mix32 and hashU32 values', () => {
    expect(intsMany(seedRng(42), 6, 8)).toStrictEqual(GOLDEN_INT_42);
    expect(nextUnit(seedRng(3)).value).toBe(GOLDEN_UNIT_3);
    expect(mix32(0)).toBe(0);
    expect(mix32(1)).toBe(GOLDEN_MIX_1);
    expect(hashU32(7, 3)).toBe(GOLDEN_HASH_7_3);
  });

  it('hashes text keys stably', () => {
    expect(hashSeed('tasks:2026-09-26')).toBe(GOLDEN_TEXT_HASH);
    expect(hashSeed('')).toBe(0x811c9dc5);
  });

  it('returns the same sequence for the same seed', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        expect(drawMany(seedRng(seed), 20)).toStrictEqual(drawMany(seedRng(seed), 20));
      }),
      { seed: 42, numRuns: 300 },
    );
  });

  it('keeps nextInt inside its range', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 1000 }), (seed, max) => {
        const { value } = nextInt(seedRng(seed), max);
        expect(Number.isInteger(value) && value >= 0 && value < max).toBe(true);
      }),
      { seed: 7, numRuns: 500 },
    );
  });

  it('rejects the biased top draw and uses the next one', () => {
    const top: RngState = [0xffffffff, 0, 0, 0];
    const next = nextU32(nextU32(top).state);
    expect(nextU32(top).value).toBe(4_294_967_295);
    expect(nextInt(top, 3)).toStrictEqual({ value: next.value % 3, state: next.state });
  });

  it('keeps nextUnit inside [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const { value } = nextUnit(seedRng(seed));
        expect(value >= 0 && value < 1).toBe(true);
      }),
      { seed: 9, numRuns: 300 },
    );
  });

  it('spreads neighbouring indices with hashU32', () => {
    expect(hashU32(7, 3)).toBe(hashU32(7, 3));
    const values = new Set(Array.from({ length: 64 }, (_, index) => hashU32(7, index)));
    expect(values.size).toBe(64);
  });
});
