// src/core/rng/sfc32.ts — the app's one seeded PRNG. A compatibility contract: never edit it.
'worklet';

/** sfc32 state: four unsigned 32-bit integers. Plain numbers, so it is JSON-serialisable. */
export type RngState = readonly [number, number, number, number];

/** One draw: the value (0 … 2^32-1) and the state to use next. */
export type RngDraw = { readonly value: number; readonly state: RngState };

const GOLDEN_GAMMA = 0x9e3779b9;
const WARM_UP_DRAWS = 12;
const TWO_POW_32 = 4294967296;

/** Integer avalanche mix (murmur3 finaliser). Only imul, xor and shifts: exact on every engine. */
export function mix32(value: number): number {
  let z = value | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Stateless hash of two integers, for per-index randomness (tile variants, per-id jitter). */
export function hashU32(a: number, b: number): number {
  return mix32(a ^ Math.imul(b | 0, GOLDEN_GAMMA));
}

/** Advances sfc32 once (Chris Doty-Humphrey's PractRand sfc32: tmp = a + b + counter++). */
export function nextU32(state: RngState): RngDraw {
  const [a, b, c, d] = state;
  const t = (((a + b) | 0) + d) | 0;
  const nextD = (d + 1) | 0;
  const nextA = b ^ (b >>> 9);
  const nextB = (c + (c << 3)) | 0;
  const rotated = (c << 21) | (c >>> 11);
  const nextC = (rotated + t) | 0;
  return { value: t >>> 0, state: [nextA >>> 0, nextB >>> 0, nextC >>> 0, nextD >>> 0] };
}

/** Expands any integer seed into a warmed-up state (the mix step every derived seed passes). */
export function seedRng(seed: number): RngState {
  const s = seed | 0;
  let state: RngState = [
    mix32(s + GOLDEN_GAMMA),
    mix32(s + 2 * GOLDEN_GAMMA),
    mix32(s + 3 * GOLDEN_GAMMA),
    mix32(s + 4 * GOLDEN_GAMMA),
  ];
  for (let i = 0; i < WARM_UP_DRAWS; i += 1) {
    state = nextU32(state).state;
  }
  return state;
}

/** Unbiased integer in [0, maxExclusive), by rejection sampling. maxExclusive: 1 … 2^32. */
export function nextInt(state: RngState, maxExclusive: number): RngDraw {
  const limit = TWO_POW_32 - (TWO_POW_32 % maxExclusive);
  let draw = nextU32(state);
  while (draw.value >= limit) {
    draw = nextU32(draw.state);
  }
  return { value: draw.value % maxExclusive, state: draw.state };
}

/** Float in [0, 1). Division is correctly rounded (IEEE 754), so this is deterministic too. */
export function nextUnit(state: RngState): RngDraw {
  const draw = nextU32(state);
  return { value: draw.value / TWO_POW_32, state: draw.state };
}

/**
 * FNV-1a over UTF-16 code units: turns a text key such as "tasks:2026-09-26" into a seed. Not
 * mixed: pass the result to seedRng before drawing. The daily seed of a civil date is
 * dailySeed(dateKey, salt) in src/core/dates/daily-seed.ts.
 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}
