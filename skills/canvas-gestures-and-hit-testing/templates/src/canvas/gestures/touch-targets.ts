// src/canvas/gestures/touch-targets.ts
// Proofs for a surface's hit-targets test: the smallest tappable cell and the reach of a lifted
// drag, computed from the same layout the canvas draws and hit-tests with.
import { cellRect, hitTest, isSameTarget } from '@/canvas/canvas-layout';

import { HIT_SLOP, liftedPoint } from './pan-intent';

import type { CanvasLayout, CanvasTarget } from '@/canvas/canvas-layout';

/**
 * The smallest touch target in points: quality-gates.json "a11y.minTouchPt" (accessibility-as-code),
 * 44 by default (Apple's minimum). An app sized to Material's 48 dp raises both together.
 */
export const MIN_TOUCH_PT = 44;

/**
 * The smallest cell (pt) among the regions whose taps act: `regionIds`, or every region. A region id
 * the layout does not have gives 0, so a test that names the wrong region fails instead of passing.
 */
export function smallestTargetPt(layout: CanvasLayout, regionIds?: readonly string[]): number {
  const ids = regionIds ?? layout.regions.map((region) => region.id);
  const cells = ids.map((id) => layout.regions.find((region) => region.id === id)?.cell ?? 0);
  return cells.length === 0 ? 0 : Math.min(...cells);
}

/** Every cell of a region's first and last row: the rows a drag lift or a screen edge can strand. */
export function edgeRowTargets(layout: CanvasLayout, regionId: string): CanvasTarget[] {
  const region = layout.regions.find((entry) => entry.id === regionId);
  if (region === undefined) return [];
  const rows = region.rows > 1 ? [0, region.rows - 1] : [0];
  return rows.flatMap((row) =>
    Array.from({ length: region.cols }, (_, col) => ({ regionId, col, row })),
  );
}

/** True when some finger position inside the canvas, lifted like a drag, lands on `target`. */
function isReachableByDrag(
  layout: CanvasLayout,
  target: CanvasTarget,
  dragLiftPt: number,
): boolean {
  const rect = cellRect(layout, target);
  if (rect === null) return false;
  const x = rect.x + rect.width / 2;
  for (let y = 0; y <= layout.height; y += 1) {
    const hit = hitTest(layout, liftedPoint({ x, y }, dragLiftPt), HIT_SLOP);
    if (isSameTarget(hit, target)) return true;
  }
  return false;
}

/** The targets no finger inside the canvas reaches once lifted by `dragLiftPt` (empty: all reach). */
export function unreachableByDrag(
  layout: CanvasLayout,
  targets: readonly CanvasTarget[],
  dragLiftPt: number,
): CanvasTarget[] {
  return targets.filter((target) => !isReachableByDrag(layout, target, dragLiftPt));
}
