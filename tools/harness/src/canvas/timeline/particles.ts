// src/canvas/timeline/particles.ts
'worklet';

/**
 * A particle burst is stateless: every particle's position is a pure function of (burst, index,
 * age). Nothing is stored per frame, so bursts replay identically, render at any moment in
 * goldens, and cost nothing when the clock is stopped.
 */
export type BurstSpec = {
  readonly seed: number;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  /** Speed range in points per second. */
  readonly minSpeed: number;
  readonly maxSpeed: number;
  /** Downward acceleration in points per second squared. */
  readonly gravity: number;
  readonly lifeMs: number;
};

/** One particle at one age: its position in canvas points and its opacity. */
export type ParticleSample = { readonly x: number; readonly y: number; readonly alpha: number };

/**
 * 16 unit vectors (cos, sin of k·22.5°), computed once and committed as literals, so the sampler
 * never calls Math.cos or Math.sin (their last bits differ between engines).
 */
const DIRECTIONS = [
  1, 0, 0.9238795325112867, 0.3826834323650898, 0.7071067811865476, 0.7071067811865476,
  0.3826834323650898, 0.9238795325112867, 0, 1, -0.3826834323650898, 0.9238795325112867,
  -0.7071067811865476, 0.7071067811865476, -0.9238795325112867, 0.3826834323650898, -1, 0,
  -0.9238795325112867, -0.3826834323650898, -0.7071067811865476, -0.7071067811865476,
  -0.3826834323650898, -0.9238795325112867, 0, -1, 0.3826834323650898, -0.9238795325112867,
  0.7071067811865476, -0.7071067811865476, 0.9238795325112867, -0.3826834323650898,
] as const;
const DIRECTION_COUNT = 16;
const GOLDEN_GAMMA = 0x9e3779b9;

/**
 * Stateless hash of two integers (the murmur3 finaliser over seed ^ index·golden gamma). Only
 * imul, xor and shifts, so it is exact on Hermes, V8 and JavaScriptCore alike.
 */
export function burstHash(seed: number, index: number): number {
  let z = seed ^ Math.imul(index | 0, GOLDEN_GAMMA);
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Pure: particle `index` of a burst at `ageMs`; direction and speed come from burstHash. */
export function sampleParticle(burst: BurstSpec, index: number, ageMs: number): ParticleSample {
  const bits = burstHash(burst.seed, index);
  const direction = bits % DIRECTION_COUNT;
  const speedT = ((bits >>> 8) & 0xff) / 255;
  const speed = burst.minSpeed + (burst.maxSpeed - burst.minSpeed) * speedT;
  const dx = DIRECTIONS[direction * 2] ?? 0;
  const dy = DIRECTIONS[direction * 2 + 1] ?? 0;
  const t = ageMs / 1000;
  return {
    x: burst.x + dx * speed * t,
    y: burst.y + dy * speed * t + 0.5 * burst.gravity * t * t,
    alpha: Math.max(0, 1 - ageMs / burst.lifeMs),
  };
}
