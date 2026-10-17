// src/services/test-hooks/debug-settings-target.ts
// How a debug link changes saved settings (language, theme) without knowing the app's settings
// store: the startup passes one DebugSettingsTarget to createTestHooks. Without one, lang= and theme=
// are refused with a clear error instead of being ignored.
import type { Language } from '@/i18n/languages';
import type { ThemePreference } from '@/theme/theme-types';

export type DebugSettingsPatch = {
  readonly language?: Language;
  readonly theme?: ThemePreference;
};

export type DebugSettingsTarget = {
  /**
   * Saves the patch through the app's own settings store (the path its settings screen takes).
   * 'restarting' when the new language flips the layout direction and the app is reloading: the
   * caller must not navigate, the reload reopens the first screen.
   */
  readonly apply: (patch: DebugSettingsPatch) => Promise<'applied' | 'restarting'>;
};
