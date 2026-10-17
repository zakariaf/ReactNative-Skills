// src/core/geom/vec2.ts
'worklet';

/** Immutable 2D vector in board or world units. */
export type Vec2 = { readonly x: number; readonly y: number };

/** The zero vector (also returned by normalize() for zero length). */
export const ZERO: Vec2 = { x: 0, y: 0 };

/** a + b. */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** a − b. */
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** a · k. */
export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

/** Dot product; the basis of projection and reflection without angles. */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Math.sqrt is correctly rounded by IEEE 754, so length() is deterministic everywhere. */
export function length(a: Vec2): number {
  return Math.sqrt(dot(a, a));
}

/** Unit vector in the direction of a, or ZERO. */
export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len === 0 ? ZERO : { x: a.x / len, y: a.y / len };
}

/** Reflects velocity `v` off a surface with unit normal `n`: v − 2(v·n)n. No angles needed. */
export function reflect(v: Vec2, n: Vec2): Vec2 {
  const d = 2 * dot(v, n);
  return { x: v.x - d * n.x, y: v.y - d * n.y };
}
