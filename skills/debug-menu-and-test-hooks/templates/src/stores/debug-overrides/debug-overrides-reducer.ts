// src/stores/debug-overrides/debug-overrides-reducer.ts
// Pure: one imperative kebab-case action per change the debug menu or a debug link makes. The store
// persists the result before anyone sees it; an action that changes nothing returns the same object,
// so the store writes nothing. Its rules as data: debug-overrides-reducer-cases.ts.
import { addDays } from '@/core/dates/date-key';

import type { DebugOverrides } from './debug-overrides';
import type { DateKey } from '@/core/dates/date-key';

export type DebugOverridesAction =
  | { readonly type: 'apply-overrides'; readonly patch: Partial<DebugOverrides> }
  | { readonly type: 'set-offline'; readonly isOn: boolean }
  | { readonly type: 'set-motion'; readonly motion: DebugOverrides['motion'] }
  | { readonly type: 'set-canvas-probe'; readonly isOn: boolean }
  /** The simulated day moves on from itself, or from the real day (read by the caller) when unset. */
  | { readonly type: 'advance-day'; readonly realToday: DateKey }
  | { readonly type: 'use-real-day' };

/** The same object when the patch changes nothing (a repeated link or tap writes nothing). */
function withPatch(overrides: DebugOverrides, patch: Partial<DebugOverrides>): DebugOverrides {
  const isSame = Object.entries(patch).every(([key, value]) =>
    Object.is(Reflect.get(overrides, key), value),
  );
  return isSame ? overrides : { ...overrides, ...patch };
}

export function debugOverridesReducer(
  overrides: DebugOverrides,
  action: DebugOverridesAction,
): DebugOverrides {
  switch (action.type) {
    case 'apply-overrides':
      return withPatch(overrides, action.patch);
    case 'set-offline':
      return withPatch(overrides, { isOffline: action.isOn });
    case 'set-motion':
      return withPatch(overrides, { motion: action.motion });
    case 'set-canvas-probe':
      return withPatch(overrides, { isCanvasProbeOn: action.isOn });
    case 'advance-day':
      return withPatch(overrides, { today: addDays(overrides.today ?? action.realToday, 1) });
    case 'use-real-day':
      return withPatch(overrides, { today: null });
  }
}
