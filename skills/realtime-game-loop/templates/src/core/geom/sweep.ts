// src/core/geom/sweep.ts
'worklet';

import { dot, length, normalize, sub } from './vec2';

import type { Vec2 } from './vec2';

/** First contact of a moving circle: fraction `t` (0…1) of this step's motion, and the surface normal. */
export type SweepHit = { readonly t: number; readonly normal: Vec2 };

/** A circle and its motion over one fixed step. */
export type MovingCircle = {
  readonly center: Vec2;
  /** Motion during this step (velocity × step time). */
  readonly motion: Vec2;
  readonly radius: number;
};

/** A wall or edge from a to b. */
export type Segment = { readonly a: Vec2; readonly b: Vec2 };

/** Moving circle vs a fixed point (a segment end-cap): smallest t with |center + t·motion − p| = r. */
export function sweepCirclePoint(circle: MovingCircle, point: Vec2): SweepHit | null {
  const m = sub(circle.center, point);
  const a = dot(circle.motion, circle.motion);
  const b = dot(m, circle.motion);
  const c = dot(m, m) - circle.radius * circle.radius;
  if (a === 0 || b >= 0) return null;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  if (t < 0 || t > 1) return null;
  const hit = {
    x: circle.center.x + circle.motion.x * t,
    y: circle.center.y + circle.motion.y * t,
  };
  return { t, normal: normalize(sub(hit, point)) };
}

/** Moving circle vs the segment's interior (the line offset by the radius, clipped to the segment). */
function sweepCircleEdge(circle: MovingCircle, segment: Segment): SweepHit | null {
  const edge = sub(segment.b, segment.a);
  const edgeLength = length(edge);
  if (edgeLength === 0) return null;
  const facing = normalize({ x: -edge.y, y: edge.x });
  const side = dot(sub(circle.center, segment.a), facing);
  const normal = side >= 0 ? facing : { x: -facing.x, y: -facing.y };
  const distance = Math.abs(side) - circle.radius;
  const approach = -dot(circle.motion, normal);
  if (approach <= 0 || distance < 0 || distance > approach) return null;
  const t = distance / approach;
  const hit = {
    x: circle.center.x + circle.motion.x * t,
    y: circle.center.y + circle.motion.y * t,
  };
  const along = dot(sub(hit, segment.a), edge) / (edgeLength * edgeLength);
  return along >= 0 && along <= 1 ? { t, normal } : null;
}

/** Earliest contact with a segment, including its rounded ends. Null = no contact this step. */
export function sweepCircleSegment(circle: MovingCircle, segment: Segment): SweepHit | null {
  const candidates = [
    sweepCircleEdge(circle, segment),
    sweepCirclePoint(circle, segment.a),
    sweepCirclePoint(circle, segment.b),
  ];
  let best: SweepHit | null = null;
  for (const hit of candidates) {
    if (hit !== null && (best === null || hit.t < best.t)) best = hit;
  }
  return best;
}

/** Overlap test without sqrt: squared distance vs squared radius sum. */
export function circlesOverlap(a: Vec2, b: Vec2, radiusSum: number): boolean {
  const d = sub(a, b);
  return dot(d, d) < radiusSum * radiusSum;
}
