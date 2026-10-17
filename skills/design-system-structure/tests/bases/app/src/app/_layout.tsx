// src/app/_layout.tsx (fixture): the root layout mounts the app theme and the text locale once, and
// inside them the navigation theme mapped from the app theme.
import { Stack } from 'expo-router';

import { NavigationThemeProvider } from '@/theme/navigation-theme';
import { TextLocaleProvider } from '@/theme/text-locale';
import { AppThemeProvider } from '@/theme/theme-provider';

const LOCALE = { language: 'en', direction: 'ltr' } as const;

export default function RootLayout(): React.JSX.Element {
  return (
    <AppThemeProvider preference="system">
      <TextLocaleProvider value={LOCALE}>
        <NavigationThemeProvider>
          <Stack />
        </NavigationThemeProvider>
      </TextLocaleProvider>
    </AppThemeProvider>
  );
}
