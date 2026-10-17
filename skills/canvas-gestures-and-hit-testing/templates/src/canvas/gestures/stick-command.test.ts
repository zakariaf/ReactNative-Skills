// src/canvas/gestures/stick-command.test.ts
import fc from 'fast-check';

import { STICK_DIRECTIONS, STICK_IDLE, stickCommand } from './stick-command';

describe('stickCommand', () => {
  it('keeps the stick idle inside the dead zone', () => {
    expect(stickCommand(5, -7)).toBe(STICK_IDLE);
  });

  it('maps the four axes to commands 1, 5, 9 and 13 (y points down)', () => {
    expect([
      stickCommand(40, 0),
      stickCommand(0, 40),
      stickCommand(-40, 0),
      stickCommand(0, -40),
    ]).toStrictEqual([1, 5, 9, 13]);
  });

  it('returns an integer command whose direction is within 11.25° of the drag', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -300, max: 300 }),
        fc.integer({ min: -300, max: 300 }),
        (dx, dy) => {
          const command = stickCommand(dx, dy);
          if (command === STICK_IDLE) return;
          const ux = STICK_DIRECTIONS[(command - 1) * 2] ?? 0;
          const uy = STICK_DIRECTIONS[(command - 1) * 2 + 1] ?? 0;
          const cosine = (dx * ux + dy * uy) / Math.sqrt(dx * dx + dy * dy);
          expect(Number.isInteger(command) && command >= 1 && command <= 16).toBe(true);
          expect(cosine).toBeGreaterThanOrEqual(0.98078528);
        },
      ),
      { seed: 23, numRuns: 400 },
    );
  });
});
