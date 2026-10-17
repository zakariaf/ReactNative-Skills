// src/features/tasks/canvas/intent-to-action.test.ts
import fc from 'fast-check';

import { listDayActions } from '@/features/tasks/progress-grid-rules';

import { intentToAction } from './intent-to-action';

import type { ProgressGridState } from './canvas-model';
import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';

/** One week: 7 days in one row, Monday and Tuesday done. */
const WEEK: ProgressGridState = { cols: 7, rows: 1, cells: [1, 1, 0, 0, 0, 0, 0], streakDays: 2 };
const day = (col: number, row = 0): CanvasTarget => ({ regionId: 'grid', col, row });
const tap = (target: CanvasTarget): CanvasIntent => ({ kind: 'tap', target, selected: null });

describe('intentToAction', () => {
  it('toggles the tapped day', () => {
    expect(intentToAction(WEEK, tap(day(3)))).toStrictEqual({ kind: 'toggle-day', cell: 3 });
  });

  it('refuses a cell off the grid and any other region', () => {
    expect(intentToAction(WEEK, tap(day(7)))).toBeNull();
    expect(intentToAction(WEEK, tap(day(0, 1)))).toBeNull();
    expect(intentToAction(WEEK, tap({ regionId: 'legend', col: 0, row: 0 }))).toBeNull();
  });

  it('gives no action once the week is closed (every day done)', () => {
    const closed = { ...WEEK, cells: WEEK.cells.map(() => 1 as const) };
    expect(intentToAction(closed, tap(day(3)))).toBeNull();
  });

  it('ignores the gestures this surface does not use', () => {
    const unused: CanvasIntent[] = [
      { kind: 'long-press', target: day(1) },
      { kind: 'swipe', direction: 'left', from: null },
      { kind: 'drag-end', from: day(0), to: day(1) },
      { kind: 'aim', dx: 10, dy: -40 },
    ];
    expect(unused.map((intent) => intentToAction(WEEK, intent))).toStrictEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('returns only actions the domain lists', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<0 | 1>(0, 1), { minLength: 7, maxLength: 7 }),
        fc.integer({ min: -1, max: 8 }),
        fc.integer({ min: -1, max: 1 }),
        (cells, col, row) => {
          const state = { ...WEEK, cells };
          const action = intentToAction(state, tap(day(col, row)));
          const listed = listDayActions(state).map((entry) => entry.cell);
          expect(action === null || listed.includes(action.cell)).toBe(true);
        },
      ),
      { seed: 7, numRuns: 200 },
    );
  });
});
