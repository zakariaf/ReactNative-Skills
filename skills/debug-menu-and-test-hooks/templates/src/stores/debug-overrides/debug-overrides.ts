// src/stores/debug-overrides/debug-overrides.ts
// Pure: the test build's switches that live outside the app's own data (the simulated day, simulated
// offline, motion held still, the canvas probe) and their stored text. The store
// (debug-overrides-store.ts) keeps them in the test-only key-value store, so a reload or a kill keeps
// them and Maestro's clearState wipes them with the app's data.
import * as v from 'valibot';

import { isDateKey } from '@/core/dates/date-key';
import { attempt, err, ok } from '@/core/result';

import type { DateKey } from '@/core/dates/date-key';
import type { Result } from '@/core/result';

/** 'still' holds every animation at its end state (screenshots, E2E); 'system' follows the phone. */
export type MotionOverride = 'system' | 'still';

export type DebugOverrides = {
  /** The day clock.today() answers instead of the real one; null = the real calendar. */
  readonly today: DateKey | null;
  /** The ConnectivityPort reports `none` to every reader while true. */
  readonly isOffline: boolean;
  readonly motion: MotionOverride;
  /** Canvas surfaces render their layout probe (`<prefix>.canvas-layout`) for E2E taps. */
  readonly isCanvasProbeOn: boolean;
};

export const DEFAULT_DEBUG_OVERRIDES: DebugOverrides = {
  today: null,
  isOffline: false,
  motion: 'system',
  isCanvasProbeOn: false,
};

const OVERRIDES_SCHEMA = v.object({
  today: v.nullable(v.pipe(v.string(), v.check(isDateKey))),
  isOffline: v.boolean(),
  motion: v.picklist(['system', 'still']),
  isCanvasProbeOn: v.boolean(),
});

export type DebugOverridesFailure = { readonly kind: 'debug-overrides-unreadable' };

/** The stored text back to overrides; null (nothing stored) is the defaults. */
export function decodeDebugOverrides(
  text: string | null,
): Result<DebugOverrides, DebugOverridesFailure> {
  if (text === null) return ok(DEFAULT_DEBUG_OVERRIDES);
  const parsed = attempt(
    (): unknown => JSON.parse(text),
    () => ({ kind: 'debug-overrides-unreadable' }) as const,
  );
  if (!parsed.ok) return parsed;
  const checked = v.safeParse(OVERRIDES_SCHEMA, parsed.value);
  return checked.success ? ok(checked.output) : err({ kind: 'debug-overrides-unreadable' });
}

export function encodeDebugOverrides(overrides: DebugOverrides): string {
  return JSON.stringify(overrides);
}
