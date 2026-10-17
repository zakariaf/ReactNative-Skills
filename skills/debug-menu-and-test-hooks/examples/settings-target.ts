// src/services/test-hooks/create-debug-settings-target.ts (example: a shape, not a template)
// The DebugSettingsTarget an app passes to createTestHooks once it saves a language and a theme
// (settings-and-preferences' store). It lives in a test-only folder, so the entry re-exports
// createDebugSettingsTarget and the startup calls TEST_ONLY.createDebugSettingsTarget(...). A debug
// link then changes the settings through the same dispatch the settings screen uses, and a language
// that flips the layout direction goes through the app's own direction restart (rtl-and-direction),
// never a second path.
import { readLayoutDirection } from '@/i18n/direction';
import { directionOf } from '@/i18n/languages';

import type { Direction } from '@/i18n/languages';
import type { DebugSettingsTarget } from '@/services/test-hooks/debug-settings-target';
import type { SettingsAction } from '@/stores/settings/settings-reducer';
import type { SettingsStore } from '@/stores/settings/settings-store';

export type SettingsTargetDeps = {
  readonly store: SettingsStore;
  /** The app's direction restart: rtl-and-direction's restartForDirection with the app's guard. */
  readonly restartForDirection: (direction: Direction) => Promise<void>;
};

export function createDebugSettingsTarget(deps: SettingsTargetDeps): DebugSettingsTarget {
  /** Dispatch writes before it publishes (synchronously); a failed write must not restart. */
  const save = (action: SettingsAction): void => {
    deps.store.getState().dispatch(action);
    const failure = deps.store.getState().lastWriteFailure;
    if (failure !== null) throw new Error(`debug link could not save settings: ${failure.kind}`);
  };
  return {
    apply: async (patch) => {
      if (patch.theme !== undefined) save({ type: 'set-theme', theme: patch.theme });
      if (patch.language === undefined) return 'applied';
      save({ type: 'set-language', language: patch.language });
      // Compare with the direction this JS run lays out in, not with the saved language: a saved
      // null (the phone's language) says nothing about it, and lang=en on an English phone must not
      // reload the app for nothing.
      const wanted = directionOf(patch.language);
      if (wanted === readLayoutDirection()) return 'applied';
      await deps.restartForDirection(wanted);
      return 'restarting';
    },
  };
}
