// src/games/ricochet-volley/rules/simulate-volley.ts
// Simulate-then-replay: applyMove runs the continuous phase here, with the same fixed step as the
// real-time loop, and returns ordinary timed events. The game stays turn-based for saves, undo,
// bots and goldens; buildTimeline turns the events into tracks that replay the path on screen.
import { sweepCircleSegment } from '@/core/geom/sweep';
import { add, reflect, scale } from '@/core/geom/vec2';
import { tickToMs } from '@/core/realtime/fixed-step';

import type { Segment, SweepHit } from '@/core/geom/sweep';
import type { Vec2 } from '@/core/geom/vec2';

/** Velocity is in world units per tick: the sim never sees milliseconds. */
export type Ball = { readonly id: number; readonly pos: Vec2; readonly vel: Vec2 };

export type VolleyEvent =
  | {
      readonly kind: 'ball-launched';
      readonly ballId: number;
      readonly x: number;
      readonly y: number;
      readonly atMs: number;
    }
  | {
      readonly kind: 'ball-bounced';
      readonly ballId: number;
      readonly x: number;
      readonly y: number;
      readonly atMs: number;
    }
  | {
      readonly kind: 'ball-out';
      readonly ballId: number;
      readonly x: number;
      readonly y: number;
      readonly atMs: number;
    };

export type Arena = {
  readonly walls: readonly Segment[];
  readonly radius: number;
  /** A ball whose centre passes this y has left through the open bottom. */
  readonly floorY: number;
  /** Hard cap: a volley always ends. */
  readonly maxTicks: number;
};

/** At most this many contacts are resolved inside one fixed step. */
const MAX_HITS_PER_STEP = 4;

function earliestHit(center: Vec2, motion: Vec2, arena: Arena): SweepHit | null {
  let best: SweepHit | null = null;
  for (const wall of arena.walls) {
    const hit = sweepCircleSegment({ center, motion, radius: arena.radius }, wall);
    if (hit !== null && (best === null || hit.t < best.t)) best = hit;
  }
  return best;
}

type StepResult = { readonly ball: Ball; readonly bounces: readonly Vec2[] };

/** One fixed step: sweep, move to the earliest contact, reflect, spend the rest (≤ 4 contacts). */
function stepBall(ball: Ball, arena: Arena): StepResult {
  let pos = ball.pos;
  let vel = ball.vel;
  let remaining = 1;
  const bounces: Vec2[] = [];
  for (let hits = 0; hits < MAX_HITS_PER_STEP && remaining > 0; hits += 1) {
    const motion = scale(vel, remaining);
    const hit = earliestHit(pos, motion, arena);
    if (hit === null) {
      pos = add(pos, motion);
      remaining = 0;
    } else {
      pos = add(pos, scale(motion, hit.t));
      vel = reflect(vel, hit.normal);
      remaining *= 1 - hit.t;
      bounces.push(pos);
    }
  }
  return { ball: { ...ball, pos, vel }, bounces };
}

/** Pure and deterministic: the same balls and arena always give the same events. */
export function simulateVolley(balls: readonly Ball[], arena: Arena): readonly VolleyEvent[] {
  const events: VolleyEvent[] = balls.map((b) => ({
    kind: 'ball-launched',
    ballId: b.id,
    x: b.pos.x,
    y: b.pos.y,
    atMs: 0,
  }));
  let live = [...balls];
  for (let tick = 1; tick <= arena.maxTicks && live.length > 0; tick += 1) {
    const next: Ball[] = [];
    for (const ball of live) {
      const step = stepBall(ball, arena);
      for (const p of step.bounces)
        events.push({
          kind: 'ball-bounced',
          ballId: ball.id,
          x: p.x,
          y: p.y,
          atMs: tickToMs(tick),
        });
      const { pos } = step.ball;
      if (pos.y > arena.floorY || tick === arena.maxTicks) {
        events.push({
          kind: 'ball-out',
          ballId: ball.id,
          x: pos.x,
          y: pos.y,
          atMs: tickToMs(tick),
        });
      } else next.push(step.ball);
    }
    live = next;
  }
  return events;
}
