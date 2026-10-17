// src/stores/settings/settings-reducer.ts
// Pure: one imperative kebab-case action per change a settings row can make. The store persists
// the result before anyone sees it; an action that changes nothing returns the same object, so
// the store writes nothing. Its rules as data: settings-reducer-cases.ts (every action, the no-ops).
import { DEFAULT_SETTINGS } from './settings-schema';

import type { Settings } from './settings-schema';

export type SettingsAction =
  | { readonly type: 'set-language'; readonly language: Settings['language'] }
  | { readonly type: 'set-digits'; readonly digits: Settings['digits'] }
  | { readonly type: 'set-theme'; readonly theme: Settings['theme'] }
  | {
      readonly type: 'set-reduce-motion';
      readonly reduceMotion: Settings['reduceMotion'];
    }
  | { readonly type: 'set-haptics'; readonly isOn: boolean }
  | {
      readonly type: 'set-sound';
      readonly isOn: boolean;
      readonly volume: number;
    }
  | { readonly type: 'reset-settings' };

/** Rounds into 0..100; a value that is not a finite number keeps `fallback`. */
export function clampPercent(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** The same object when the patch changes nothing (so a repeated tap writes nothing). */
function withPatch(settings: Settings, patch: Partial<Settings>): Settings {
  const isSame = Object.entries(patch).every(([key, value]) =>
    Object.is(Reflect.get(settings, key), value),
  );
  return isSame ? settings : { ...settings, ...patch };
}

export function settingsReducer(settings: Settings, action: SettingsAction): Settings {
  switch (action.type) {
    case 'set-language':
      return withPatch(settings, { language: action.language });
    case 'set-digits':
      return withPatch(settings, { digits: action.digits });
    case 'set-theme':
      return withPatch(settings, { theme: action.theme });
    case 'set-reduce-motion':
      return withPatch(settings, { reduceMotion: action.reduceMotion });
    case 'set-haptics':
      return withPatch(settings, { hapticsEnabled: action.isOn });
    case 'set-sound':
      return withPatch(settings, {
        soundEnabled: action.isOn,
        soundVolume: clampPercent(action.volume, settings.soundVolume),
      });
    case 'reset-settings':
      return withPatch(settings, DEFAULT_SETTINGS);
  }
}
