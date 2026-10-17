// src/canvas/gestures/touch-targets.test.ts
import { edgeRowTargets, MIN_TOUCH_PT, smallestTargetPt, unreachableByDrag } from './touch-targets';

import type { CanvasLayout } from '@/canvas/canvas-layout';

/** A 4 × 4 grid of 50 pt cells that ends at the bottom of a 200 pt canvas, above a 40 pt tray. */
const FLUSH: CanvasLayout = {
  width: 200,
  height: 240,
  isMirrored: false,
  regions: [
    { id: 'grid', x: 0, y: 0, cell: 50, cols: 4, rows: 4 },
    { id: 'tray', x: 0, y: 200, cell: 40, cols: 5, rows: 1 },
  ],
};

describe('touch targets', () => {
  it('uses the accessibility minimum of 44 pt', () => {
    expect(MIN_TOUCH_PT).toBe(44);
  });

  it('reports the smallest cell of the regions whose taps act', () => {
    expect(smallestTargetPt(FLUSH)).toBe(40);
    expect(smallestTargetPt(FLUSH, ['grid'])).toBe(50);
  });

  it('gives 0 for a region the layout does not have, so the test fails loudly', () => {
    expect(smallestTargetPt(FLUSH, ['board'])).toBe(0);
  });

  it('lists the first and the last row of a region', () => {
    const cells = edgeRowTargets(FLUSH, 'grid').map(({ col, row }) => [col, row]);
    expect(cells).toStrictEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('finds every edge row reachable while the canvas keeps a lift of room below it', () => {
    expect(unreachableByDrag(FLUSH, edgeRowTargets(FLUSH, 'grid'), 40)).toStrictEqual([]);
  });

  it('reports the last row as stranded when the lift is taller than the room below it', () => {
    const stranded = unreachableByDrag(FLUSH, edgeRowTargets(FLUSH, 'grid'), 100);
    expect(stranded.map(({ row }) => row)).toStrictEqual([3, 3, 3, 3]);
  });
});
