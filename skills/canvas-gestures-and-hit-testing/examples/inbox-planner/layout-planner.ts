// src/features/planner/canvas/layout-planner.ts
'worklet';

import { fitGrid } from '@/canvas/canvas-layout';

import type { CanvasLayout, Rect } from '@/canvas/canvas-layout';
import type { LayoutInput } from '@/canvas/canvas-types';

/** What the layout needs from the view (in the app, to-view.ts exports the full PlannerView). */
export type PlannerLayoutView = { readonly weeks: number; readonly inboxSlots: number };

const PAD = 8;
const INBOX_SHARE = 0.22;
const WEEKDAYS = 7;
/**
 * A dragged task's preview (and its drop cell) sits this far above the finger, so the thumb does not
 * hide it. The surface declares it (plannerSurface.dragLiftPt) and the gesture layer applies it; this
 * layout keeps at least this much canvas below the last week: the inbox lies there in portrait, and
 * a free strip of this height when the inbox stands beside the month.
 */
export const DRAG_LIFT_PT = 40;

/** The month grid and the inbox tray: below in portrait, beside it on a wide canvas. */
export function layoutPlanner(input: LayoutInput<PlannerLayoutView>): CanvasLayout {
  const { view } = input;
  const isWide = input.width > input.height * 1.2;
  const inner: Rect = {
    x: PAD,
    y: PAD,
    width: input.width - 2 * PAD,
    height: input.height - 2 * PAD,
  };
  const split = isWide ? inner.width * (1 - INBOX_SHARE) : inner.height * (1 - INBOX_SHARE);
  const monthBox = isWide
    ? { ...inner, width: split, height: inner.height - DRAG_LIFT_PT }
    : { ...inner, height: split };
  const inboxBox = isWide
    ? { ...inner, x: inner.x + split, width: inner.width - split }
    : { ...inner, y: inner.y + split, height: inner.height - split };
  const month = fitGrid({ box: monthBox, cols: WEEKDAYS, rows: view.weeks });
  const inbox = fitGrid({
    box: inboxBox,
    cols: isWide ? 1 : view.inboxSlots,
    rows: isWide ? view.inboxSlots : 1,
  });
  return {
    width: input.width,
    height: input.height,
    isMirrored: input.isMirrored,
    regions: [
      { id: 'month', ...month },
      { id: 'inbox', ...inbox },
    ],
  };
}
