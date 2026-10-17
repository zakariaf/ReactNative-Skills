// src/stores/debug-overrides/debug-overrides-selectors.test.ts
// Each selector returns a primitive or a reference already in the state, so a component that reads
// it re-renders only when that value really changes.
import { createFakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { DEFAULT_DEBUG_OVERRIDES, encodeDebugOverrides } from './debug-overrides';
import { selectDispatch, selectIsMotionStill, selectOverrides } from './debug-overrides-selectors';
import { createDebugOverridesStore } from './debug-overrides-store';

import type { DebugOverrides } from './debug-overrides';
import type { DebugOverridesStore } from './debug-overrides-store';

function storeWith(overrides: DebugOverrides = DEFAULT_DEBUG_OVERRIDES): DebugOverridesStore {
  return createDebugOverridesStore({
    storage: createFakeDebugStorage(encodeDebugOverrides(overrides)),
    errorLog: createFakeErrorLog(),
  });
}

describe('debug overrides selectors', () => {
  it('returns the overrides object held in the state, the same reference on every read', () => {
    const state = storeWith().getState();

    expect(selectOverrides(state)).toBe(state.overrides);
    expect(selectOverrides(state)).toBe(selectOverrides(state));
  });

  it('says whether motion is held still', () => {
    expect(selectIsMotionStill(storeWith().getState())).toBe(false);
    expect(
      selectIsMotionStill(storeWith({ ...DEFAULT_DEBUG_OVERRIDES, motion: 'still' }).getState()),
    ).toBe(true);
  });

  it('returns the one dispatch, unchanged by a change of state', () => {
    const store = storeWith();
    const before = selectDispatch(store.getState());

    before({ type: 'set-offline', isOn: true });

    expect(selectDispatch(store.getState())).toBe(before);
    expect(selectOverrides(store.getState()).isOffline).toBe(true);
  });
});
