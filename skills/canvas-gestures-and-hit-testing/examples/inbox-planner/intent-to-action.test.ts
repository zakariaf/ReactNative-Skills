// src/features/planner/canvas/intent-to-action.test.ts
import fc from 'fast-check';

import { listScheduleActions } from '@/features/planner/planner-rules';

import { intentToAction, SELECT_REGIONS } from './intent-to-action';

import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type { PlannerState } from '@/features/planner/planner-rules';

/** Two weeks; today is day 3; day 5 is full; the inbox holds two tasks and an empty slot. */
const STATE: PlannerState = {
  weeks: 2,
  dayLoads: [0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
  todayIndex: 3,
  inbox: ['call-plumber', 'renew-passport', null],
  maxPerDay: 3,
};
const day = (col: number, row = 0): CanvasTarget => ({ regionId: 'month', col, row });
const slot = (index: number): CanvasTarget => ({ regionId: 'inbox', col: index, row: 0 });

describe('planner intentToAction', () => {
  it('schedules the dragged task on the day where the finger lets go', () => {
    expect(intentToAction(STATE, { kind: 'drag-end', from: slot(1), to: day(4) })).toStrictEqual({
      kind: 'schedule-task',
      taskId: 'renew-passport',
      day: 4,
    });
  });

  it('reads the slot from the row when the inbox stands beside the month', () => {
    const beside = { regionId: 'inbox', col: 0, row: 1 };
    expect(intentToAction(STATE, { kind: 'drag-end', from: beside, to: day(4) })).toStrictEqual({
      kind: 'schedule-task',
      taskId: 'renew-passport',
      day: 4,
    });
  });

  it('refuses a past day, a full day, an empty slot, a drop off the month and a drag from a day', () => {
    const intents: CanvasIntent[] = [
      { kind: 'drag-end', from: slot(0), to: day(1) },
      { kind: 'drag-end', from: slot(0), to: day(5) },
      { kind: 'drag-end', from: slot(2), to: day(4) },
      { kind: 'drag-end', from: slot(0), to: null },
      { kind: 'drag-end', from: day(4), to: day(6) },
    ];
    expect(intents.map((intent) => intentToAction(STATE, intent))).toStrictEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('schedules the selected task where the next tap lands (tap-then-tap)', () => {
    const tap: CanvasIntent = { kind: 'tap', target: day(0, 1), selected: slot(0) };
    expect(intentToAction(STATE, tap)).toStrictEqual({
      kind: 'schedule-task',
      taskId: 'call-plumber',
      day: 7,
    });
  });

  it('selects only on an inbox tap and ignores a day tap without a selection', () => {
    const taps: CanvasIntent[] = [
      { kind: 'tap', target: slot(0), selected: null },
      { kind: 'tap', target: slot(1), selected: slot(0) },
      { kind: 'tap', target: day(4), selected: null },
    ];
    expect(taps.map((intent) => intentToAction(STATE, intent))).toStrictEqual([null, null, null]);
    expect(SELECT_REGIONS).toStrictEqual(['inbox']);
  });

  it('ignores long presses, swipes and aims', () => {
    const unused: CanvasIntent[] = [
      { kind: 'long-press', target: day(4) },
      { kind: 'swipe', direction: 'up', from: null },
      { kind: 'aim', dx: 10, dy: -40 },
    ];
    expect(unused.map((intent) => intentToAction(STATE, intent))).toStrictEqual([null, null, null]);
  });

  it('returns only listed actions, and a tap with a selection equals the drag', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: -1, max: 8 }),
        fc.integer({ min: -1, max: 2 }),
        (from, col, row) => {
          const drag = intentToAction(STATE, {
            kind: 'drag-end',
            from: slot(from),
            to: day(col, row),
          });
          const tap = intentToAction(STATE, {
            kind: 'tap',
            target: day(col, row),
            selected: slot(from),
          });
          const listed = listScheduleActions(STATE).map(
            (entry) => `${entry.taskId}@${String(entry.day)}`,
          );
          expect(drag === null || listed.includes(`${drag.taskId}@${String(drag.day)}`)).toBe(true);
          expect(tap).toStrictEqual(drag);
        },
      ),
      { seed: 11, numRuns: 200 },
    );
  });
});
