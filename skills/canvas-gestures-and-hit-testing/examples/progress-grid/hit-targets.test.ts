// src/features/tasks/canvas/hit-targets.test.ts
import { MIN_TOUCH_PT, smallestTargetPt } from '@/canvas/gestures/touch-targets';

import { layoutProgressGrid } from './layout-progress-grid';

import type { ProgressGridView } from './to-view';

/**
 * The canvas on the smallest window the app supports: 360 × 640 dp (a small Android phone; every
 * current iPhone is larger), minus 16 pt side gutters and about 200 pt of status bar, header,
 * summary and tab bar. Take these numbers from your own smallest screen, not from this example.
 */
const SMALLEST_CANVAS = { width: 328, height: 440 };
/** The largest grid the surface ever shows: a month as 7 days × 6 weeks. */
const LARGEST_VIEW: ProgressGridView = {
  cols: 7,
  rows: 6,
  cells: Array.from({ length: 42 }, () => 0),
  streakText: '0',
};

describe('progress grid hit targets', () => {
  it('keeps every day at least the minimum touch target on the smallest canvas', () => {
    for (const isMirrored of [false, true]) {
      const layout = layoutProgressGrid({ ...SMALLEST_CANVAS, view: LARGEST_VIEW, isMirrored });
      expect(smallestTargetPt(layout, ['grid'])).toBeGreaterThanOrEqual(MIN_TOUCH_PT);
    }
  });
});
