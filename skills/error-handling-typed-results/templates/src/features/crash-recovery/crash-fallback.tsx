// src/features/crash-recovery/crash-fallback.tsx
// The app's root fallback, the `Fallback` the root layout hands createRouteErrorBoundary. It renders
// outside every provider the root layout mounts (Expo Router's boundary replaces the layout), so it
// reads no React context that lacks a default. useTheme() is safe: design-system-structure's theme
// context defaults to the app's light theme, the same theme AppText falls back to, so the text and
// the background stay a pair whose contrast the theme proves. Copy comes from i18n-strings-and-
// catalogs' createTranslateNow (src/i18n/translate-now.ts), a t() that needs no provider: it uses the
// language and digits I18nProvider showed last, so the person keeps their own language, and the
// device's languages when no provider committed yet. The text locale reads the same languageNow(),
// so the copy and its direction always agree. Expo Router's root mounts SafeAreaProvider above the
// layout, so safe-area hooks still work. Keep it trivial: nothing catches or records an error
// thrown here.
import { directionOf } from '@/i18n/languages';
import { createTranslateNow, languageNow } from '@/i18n/translate-now';
import { appErrorNet } from '@/services/error-net/app-error-net';
import { TextLocaleProvider } from '@/theme/text-locale';
import { useTheme } from '@/theme/use-theme';

import { CrashScreen } from './crash-screen';

import type { CrashFallbackProps } from './create-route-error-boundary';

/** A missing crash message is recorded, never thrown: a throw here would be an unrecorded crash. */
function reportMessageError(error: Error): void {
  appErrorNet.report({ source: 'render', error, isFatal: false });
}

/** The crash screen with the app's copy and background; its one way out is `onRestart`. */
export function CrashFallback({ onRestart }: CrashFallbackProps): React.JSX.Element {
  const theme = useTheme();
  const t = createTranslateNow(reportMessageError);
  const { language } = languageNow();
  return (
    <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
      <CrashScreen
        title={t('crash.title')}
        body={t('crash.body')}
        actionLabel={t('crash.restart')}
        onAction={onRestart}
        backgroundColor={theme.colors.background}
      />
    </TextLocaleProvider>
  );
}
