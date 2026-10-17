// src/features/settings/language-change.ts
// Pure: what choosing a language does. The text switches at once (the store change re-renders the
// i18n provider); only a flip of the layout direction (English to Arabic, say) also needs the
// "Restart to apply" dialog, because React Native applies a new direction at the next start. The
// saved choice is written either way, so "Not now" keeps it for the next cold start.
import { directionOf } from '@/i18n/languages';
import { resolveLanguage } from '@/i18n/resolve-language';

import type { Direction, Language } from '@/i18n/languages';
import type { DeviceLocale } from '@/i18n/resolve-language';
import type { SettingsAction } from '@/stores/settings/settings-reducer';

export type LanguageChangeInput = {
  /** The chosen row: a language, or null for "System (…)". */
  readonly next: Language | null;
  /** expo-localization's locales ("System" resolves against them). */
  readonly deviceLocales: readonly DeviceLocale[];
  /** The direction the layout has now (rtl-and-direction), not the direction of the current text. */
  readonly layoutDirection: Direction;
};

export type LanguageChange = {
  readonly action: SettingsAction;
  /** The language the app will show ("System" resolved against the phone). */
  readonly resolved: Language;
  /** True only when the new language reads the other way: show the restart dialog. */
  readonly isRestartNeeded: boolean;
};

export function planLanguageChange(input: LanguageChangeInput): LanguageChange {
  const resolved = resolveLanguage(input.next, input.deviceLocales);
  return {
    action: { type: 'set-language', language: input.next },
    resolved,
    isRestartNeeded: directionOf(resolved) !== input.layoutDirection,
  };
}
