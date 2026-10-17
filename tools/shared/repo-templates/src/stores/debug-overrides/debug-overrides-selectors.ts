// src/stores/debug-overrides/debug-overrides-selectors.ts
// Each selector returns a primitive or a reference already in the state.
import type { DebugOverridesState } from './debug-overrides-store';

type Overrides = DebugOverridesState['overrides'];

export const selectOverrides = (state: DebugOverridesState): Overrides => state.overrides;
export const selectIsMotionStill = (state: DebugOverridesState): boolean =>
  state.overrides.motion === 'still';
export const selectDispatch = (state: DebugOverridesState): DebugOverridesState['dispatch'] =>
  state.dispatch;
