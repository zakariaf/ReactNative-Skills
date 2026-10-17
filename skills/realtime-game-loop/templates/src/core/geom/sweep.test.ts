// src/core/geom/sweep.test.ts
import fc from 'fast-check';

import { circlesOverlap, sweepCirclePoint, sweepCircleSegment } from './sweep';
import { length, reflect } from './vec2';

const FLOOR = { a: { x: 0, y: 100 }, b: { x: 200, y: 100 } };

describe('sweepCircleSegment', () => {
  it('finds the contact time and normal against a wall', () => {
    const hit = sweepCircleSegment(
      { center: { x: 50, y: 50 }, motion: { x: 0, y: 80 }, radius: 10 },
      FLOOR,
    );
    expect(hit?.t).toBe(0.5);
    expect(hit?.normal.y).toBe(-1);
  });

  it('hits the rounded end of a segment', () => {
    const hit = sweepCircleSegment(
      { center: { x: 230, y: 100 }, motion: { x: -40, y: 0 }, radius: 10 },
      FLOOR,
    );
    expect(hit?.t).toBeCloseTo(0.5);
  });

  it('finds no contact when the circle moves away or stops short', () => {
    expect(
      sweepCircleSegment({ center: { x: 50, y: 50 }, motion: { x: 0, y: -40 }, radius: 10 }, FLOOR),
    ).toBeNull();
    expect(
      sweepCircleSegment({ center: { x: 50, y: 50 }, motion: { x: 0, y: 10 }, radius: 10 }, FLOOR),
    ).toBeNull();
  });

  it('ignores a point the circle does not move towards', () => {
    const still = { center: { x: 0, y: 0 }, motion: { x: 0, y: 0 }, radius: 5 };
    expect(sweepCirclePoint(still, { x: 3, y: 0 })).toBeNull();
  });

  it('keeps the speed unchanged on reflection', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (vx, vy) => {
          const out = reflect({ x: vx, y: vy }, { x: 0, y: -1 });
          expect(length(out)).toBeCloseTo(length({ x: vx, y: vy }), 9);
        },
      ),
      { seed: 5, numRuns: 300 },
    );
  });
});

describe('circlesOverlap', () => {
  it('compares squared distances without a square root', () => {
    expect(circlesOverlap({ x: 0, y: 0 }, { x: 3, y: 4 }, 6)).toBe(true);
    expect(circlesOverlap({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(false);
  });
});
