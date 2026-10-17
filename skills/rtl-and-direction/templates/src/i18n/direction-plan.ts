// src/i18n/direction-plan.ts
// The pure startup decision: compare the layout direction of this JS run with the direction of the
// language the app is about to show, and remember whether the last reload already tried this flip.
import { directionOf } from './languages';

import type { Direction, Language } from './languages';
import type { PendingRestart } from '@/services/direction-guard/direction-guard-port';

export type DirectionPlan = 'keep' | 'restart' | 'give-up';

export type DirectionPlanInput = {
  /** The language the app will show: the saved choice, else the device's, else the source. */
  readonly language: Language;
  /** What React Native lays this JS run out in (readLayoutDirection()). */
  readonly layout: Direction;
  /** The direction the previous reload was for (the guard), null, or 'unreadable'. */
  readonly pendingRestart: PendingRestart;
};

/**
 * keep: the layout already matches the language. restart: flip once. give-up: the last reload was
 * for this very direction and the layout still does not match, so continue in the current layout
 * and report it instead of reloading forever. An unreadable guard gives up too: without the record
 * nothing could stop a flip that never takes from restarting at every launch. A restart also repairs
 * drift, such as a forced direction left behind by an older build or a device restore.
 */
export function planDirection({
  language,
  layout,
  pendingRestart,
}: DirectionPlanInput): DirectionPlan {
  const desired = directionOf(language);
  if (desired === layout) return 'keep';
  if (pendingRestart === desired || pendingRestart === 'unreadable') return 'give-up';
  return 'restart';
}
