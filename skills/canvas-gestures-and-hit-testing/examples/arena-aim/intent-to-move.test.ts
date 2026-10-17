// src/games/arena/canvas/intent-to-move.test.ts
import fc from 'fast-check';

import { aimMove, intentToMove } from './intent-to-move';

describe('arena intentToMove', () => {
  it('launches opposite to the pull, as an integer unit vector', () => {
    expect(intentToMove({ launchesLeft: 3 }, { kind: 'aim', dx: 0, dy: 80 })).toStrictEqual({
      kind: 'launch-runner',
      aimX: 0,
      aimY: -1000,
    });
  });

  it('ignores short pulls, downward launches and an empty supply', () => {
    expect(aimMove(5, 10)).toBeNull();
    expect(aimMove(0, -80)).toBeNull();
    expect(intentToMove({ launchesLeft: 0 }, { kind: 'aim', dx: 0, dy: 80 })).toBeNull();
  });

  it('always yields integers of unit length (± rounding)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -400, max: 400 }),
        fc.integer({ min: 21, max: 400 }),
        (dx, dy) => {
          const move = aimMove(dx, dy);
          if (move === null) return;
          expect(Number.isInteger(move.aimX) && Number.isInteger(move.aimY)).toBe(true);
          const length = Math.sqrt(move.aimX * move.aimX + move.aimY * move.aimY);
          expect(Math.abs(length - 1000)).toBeLessThanOrEqual(1);
        },
      ),
      { seed: 31, numRuns: 300 },
    );
  });
});
