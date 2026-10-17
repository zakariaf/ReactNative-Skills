// src/features/settings-effects/preferences-root.tsx
// The effect of the Language, Numbers, Theme and Reduce motion settings: the app's providers take
// their values from the settings store, so a change reaches every screen at once, with no restart
// (a layout-direction flip is the one exception: language-change.ts). AppRoot mounts it inside
// SettingsStoreProvider, around the root stack, in place of fixed provider values. The Reduce motion
// choice goes down as the plain preference context: the root stack's RootMotion (app-startup-and-
// bootstrap) turns it into the app's one MotionConfig, or hands it to a root kit's motion slot (a
// test build holds motion still), so the canonical root stack stays unchanged.
import { I18nProvider } from '@/i18n/i18n-provider';
import { directionOf } from '@/i18n/languages';
import { resolveLanguage } from '@/i18n/resolve-language';
import {
  selectDigits,
  selectLanguage,
  selectReduceMotionPreference,
  selectThemePreference,
} from '@/stores/settings/settings-selectors';
import { useSettingsStore } from '@/stores/settings/settings-store';
import { TextLocaleProvider } from '@/theme/text-locale';
import { AppThemeProvider } from '@/theme/theme-provider';
import { ReduceMotionPreferenceContext } from '@/ui/a11y/use-reduce-motion';

import type { DeviceLocale } from '@/i18n/resolve-language';
import type { ReactNode } from 'react';

export type PreferencesRootProps = {
  /**
   * expo-localization's locales: getLocales() at startup, or useLocales() so a language change in
   * Android's system settings (which does not restart the app, unlike iOS) re-resolves "System".
   */
  readonly deviceLocales: readonly DeviceLocale[];
  /** The error log's record, for i18n and root-view paint failures. */
  readonly onError: (error: unknown) => void;
  readonly children: ReactNode;
};

export function PreferencesRoot(props: PreferencesRootProps): ReactNode {
  const { deviceLocales, onError, children } = props;
  const language = resolveLanguage(useSettingsStore(selectLanguage), deviceLocales);
  const digits = useSettingsStore(selectDigits);
  const theme = useSettingsStore(selectThemePreference);
  const reduceMotion = useSettingsStore(selectReduceMotionPreference);
  return (
    <I18nProvider language={language} digits={digits} onError={onError}>
      <AppThemeProvider preference={theme} onError={onError}>
        <ReduceMotionPreferenceContext value={reduceMotion}>
          <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
            {children}
          </TextLocaleProvider>
        </ReduceMotionPreferenceContext>
      </AppThemeProvider>
    </I18nProvider>
  );
}
