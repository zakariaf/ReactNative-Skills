// src/games/ricochet-volley/rules/simulate-volley.test.ts
import fc from 'fast-check';

import { length } from '@/core/geom/vec2';
import { STEP_MS } from '@/core/realtime/fixed-step';

import { simulateVolley } from './simulate-volley';

import type { Arena, Ball } from './simulate-volley';

/** A 400 × 600 box with an open bottom; the side walls reach past the floor line. */
const ARENA: Arena = {
  walls: [
    { a: { x: 0, y: 640 }, b: { x: 0, y: 0 } },
    { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
    { a: { x: 400, y: 0 }, b: { x: 400, y: 640 } },
  ],
  radius: 8,
  floorY: 620,
  maxTicks: 2400,
};

const ball = (vx: number, vy: number): Ball => ({
  id: 1,
  pos: { x: 200, y: 560 },
  vel: { x: vx, y: vy },
});

describe('simulateVolley', () => {
  it('bounces off the walls and leaves through the open bottom', () => {
    const events = simulateVolley([ball(3, -5)], ARENA);
    expect(events[0]?.kind).toBe('ball-launched');
    expect(events.filter((e) => e.kind === 'ball-bounced').length).toBeGreaterThan(1);
    expect(events.at(-1)?.kind).toBe('ball-out');
  });

  it('keeps every contact inside the arena and never speeds a ball up', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -60, max: 60 }),
        fc.integer({ min: -60, max: -5 }),
        (vx, vy) => {
          const shot = ball(vx / 10, vy / 10);
          const speed = length(shot.vel);
          const events = simulateVolley([shot], ARENA);
          events.forEach((e, i) => {
            expect(e.x).toBeGreaterThanOrEqual(ARENA.radius - 1e-6);
            expect(e.x).toBeLessThanOrEqual(400 - ARENA.radius + 1e-6);
            expect(e.y).toBeGreaterThanOrEqual(ARENA.radius - 1e-6);
            const before = events[i - 1];
            if (before === undefined) return;
            const ticks = Math.round((e.atMs - before.atMs) / STEP_MS) + 1;
            const travelled = length({ x: e.x - before.x, y: e.y - before.y });
            expect(travelled).toBeLessThanOrEqual(speed * ticks + 1e-6);
          });
        },
      ),
      { seed: 13, numRuns: 150 },
    );
  });

  it('gives the same volley for the same shot (replays and goldens)', () => {
    expect(simulateVolley([ball(2.5, -4)], ARENA)).toStrictEqual(
      simulateVolley([ball(2.5, -4)], ARENA),
    );
  });
});
