// src/app/_layout.tsx
// Example (a shape to imitate): the root layout starts the system accessibility store once, so
// useReduceMotion() sees the phone's switch (iOS Reduce Motion, Android Remove animations) and its
// live changes. MotionConfig itself is mounted by the root stack (examples/root-stack.tsx), because
// the providers here already fill the JSX depth the lint allows; check-motion follows the root
// layout's imports three levels deep to find it. Pass the saved "Reduce motion" preference
// (settings-and-preferences) instead of "system" once the app has the setting.
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RootStack } from '@/features/root-navigator/root-stack';
import { startApp } from '@/services/start-app';
import { AppThemeProvider } from '@/theme/theme-provider';
import { watchSystemA11y } from '@/ui/a11y/system-a11y-store';

export default function RootLayout(): React.JSX.Element {
  const [app] = useState(startApp);
  useEffect(
    () =>
      watchSystemA11y((error: unknown) => {
        app.errorLog.record('startup', error);
      }),
    [app],
  );
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider preference="system">
        <RootStack reduceMotion="system" />
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
