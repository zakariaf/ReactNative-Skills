// src/app/_layout.tsx
// Example (a shape to imitate): the root layout mounts the design system's providers once, around
// the root Stack. AppThemeProvider comes first (it also paints the root view behind every screen);
// NavigationThemeProvider (templates/src/theme/navigation-theme.tsx) inside it gives the navigator
// the app theme's colours, replacing the template's ThemeProvider value={DarkTheme | DefaultTheme}.
// The inputs come from other layers: the saved theme preference (settings-and-preferences), the UI
// language and direction (i18n-strings-and-catalogs, rtl-and-direction), the press feedback
// (audio-and-haptics-feedback) and the error log that records a failed root-view paint
// (error-handling-typed-results). The hooks named below are those layers' own; replace them with
// what the app has. When the app's own providers (services, data, i18n) push the nesting past the
// lint's JSX depth of 5, move NavigationThemeProvider and the Stack into a RootStack component of
// its own file outside src/app and render <RootStack /> here, still inside AppThemeProvider
// (references/theme-in-react-native.md, "Mounting").
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useLocale } from '@/i18n/use-locale';
import { usePressFeedbackPlayer } from '@/services/feedback/use-press-feedback-player';
import { useServices } from '@/services/services-context';
import { selectThemePreference } from '@/stores/settings-selectors';
import { useSettingsStore } from '@/stores/settings-store';
import { NavigationThemeProvider } from '@/theme/navigation-theme';
import { TextLocaleProvider } from '@/theme/text-locale';
import { AppThemeProvider } from '@/theme/theme-provider';
import { PressFeedbackProvider } from '@/ui/press-feedback-context';

export default function RootLayout(): React.JSX.Element {
  const preference = useSettingsStore(selectThemePreference);
  const { language, direction } = useLocale();
  const playTap = usePressFeedbackPlayer('tap');
  const { errorLog } = useServices();
  const recordThemeError = (error: unknown): void => {
    errorLog.record('service', error); // expo-system-ui failed to paint the root view
  };
  return (
    <AppThemeProvider preference={preference} onError={recordThemeError}>
      <TextLocaleProvider value={{ language, direction }}>
        {/* Only for an app that opted into a tap sound; playsSound turns Android's own click off. */}
        <PressFeedbackProvider onPress={playTap} playsSound>
          <NavigationThemeProvider>
            {/* style="auto" follows Appearance, which AppThemeProvider keeps in step with the setting. */}
            <StatusBar style="auto" />
            <Stack />
          </NavigationThemeProvider>
        </PressFeedbackProvider>
      </TextLocaleProvider>
    </AppThemeProvider>
  );
}
