// src/features/planner/canvas/hit-targets.test.ts
import {
  edgeRowTargets,
  MIN_TOUCH_PT,
  smallestTargetPt,
  unreachableByDrag,
} from '@/canvas/gestures/touch-targets';

import { DRAG_LIFT_PT, layoutPlanner } from './layout-planner';

/** The smallest window the app supports (360 × 640 dp) minus gutters, header and tab bar. */
const SMALLEST_CANVAS = { width: 328, height: 440 };
/** Wide canvases: a phone on its side and a tablet in landscape (the inbox stands beside the month). */
const WIDE_CANVASES = [
  { width: 820, height: 420 },
  { width: 1024, height: 700 },
];
/** The largest view: five weeks and three inbox slots. */
const LARGEST_VIEW = { weeks: 5, inboxSlots: 3 };

describe('planner hit targets', () => {
  it('keeps days and inbox slots at least the minimum touch target on the smallest canvas', () => {
    const layout = layoutPlanner({ ...SMALLEST_CANVAS, view: LARGEST_VIEW, isMirrored: false });
    expect(smallestTargetPt(layout, ['month', 'inbox'])).toBeGreaterThanOrEqual(MIN_TOUCH_PT);
  });

  it('keeps the first and the last week reachable by a lifted drag in portrait', () => {
    const layout = layoutPlanner({ ...SMALLEST_CANVAS, view: LARGEST_VIEW, isMirrored: false });
    expect(unreachableByDrag(layout, edgeRowTargets(layout, 'month'), DRAG_LIFT_PT)).toStrictEqual(
      [],
    );
  });

  it.each(WIDE_CANVASES)(
    'keeps every edge week reachable on a wide $width × $height canvas',
    (size) => {
      const layout = layoutPlanner({ ...size, view: LARGEST_VIEW, isMirrored: true });
      expect(layout.regions[1]?.cols).toBe(1);
      const edges = edgeRowTargets(layout, 'month');
      expect(unreachableByDrag(layout, edges, DRAG_LIFT_PT)).toStrictEqual([]);
    },
  );
});
