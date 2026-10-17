// src/features/planner/canvas/intent-to-action.ts
// Schedule an inbox task by dragging it onto a day, or by tapping it and then the day
// (tap-then-tap). The inbox is a select region: a tap there only selects, and the screen's model
// hook keeps that selection and hands it back as `intent.selected` on the next tap. The drag lift is
// applied by the gesture layer: `intent.to` already is the cell the preview showed, so no offset here.
import { listScheduleActions } from '@/features/planner/planner-rules';

import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type { PlannerAction, PlannerState } from '@/features/planner/planner-rules';

/** The regions whose taps select instead of act. */
export const SELECT_REGIONS: readonly string[] = ['inbox'];

const WEEKDAYS = 7;

/** The task in an inbox slot. The tray lies in one row or one column, so the slot is col + row. */
function inboxTask(state: PlannerState, target: CanvasTarget | null): string | null {
  if (target?.regionId !== 'inbox') return null;
  return state.inbox[target.col + target.row] ?? null;
}

/** The day a month cell stands for, or null off the grid. */
function dayOf(state: PlannerState, target: CanvasTarget | null): number | null {
  if (target?.regionId !== 'month') return null;
  const isInside = target.col < WEEKDAYS && target.row < state.weeks;
  return isInside && target.col >= 0 && target.row >= 0 ? target.row * WEEKDAYS + target.col : null;
}

function scheduleOf(state: PlannerState, from: CanvasTarget | null, to: CanvasTarget | null) {
  const taskId = inboxTask(state, from);
  const day = dayOf(state, to);
  return taskId === null || day === null ? null : { kind: 'schedule-task' as const, taskId, day };
}

function candidate(state: PlannerState, intent: CanvasIntent): PlannerAction | null {
  switch (intent.kind) {
    case 'drag-end':
      return scheduleOf(state, intent.from, intent.to);
    case 'tap':
      return scheduleOf(state, intent.selected, intent.target);
    case 'long-press':
    case 'swipe':
    case 'aim':
      return null;
  }
}

/** Pure: an intent becomes an action listScheduleActions lists, or null. */
export function intentToAction(state: PlannerState, intent: CanvasIntent): PlannerAction | null {
  const action = candidate(state, intent);
  if (action === null) return null;
  const isListed = listScheduleActions(state).some(
    (listed) => listed.taskId === action.taskId && listed.day === action.day,
  );
  return isListed ? action : null;
}
