// src/features/root-navigator/root-stack.tsx
// Device-only: covered by the app launch on a device (it only composes the tested MotionConfig, NavigationThemeProvider and AppStack)
// The providers above the root Stack, rendered by the root layout inside AppThemeProvider (it lives in
// its own file because the layout's providers fill the JSX depth the lint allows):
// GestureHandlerRootView, the one gesture root every gesture and gesture-driven canvas needs;
// MotionConfig, which gives useReduceMotion() the reduce-motion preference ("system" until the app
// has the setting) and sets Reanimated's global reduce-motion mode; and the navigation theme mapped
// from the app theme, so headers and screen backgrounds follow light and dark. It reads nothing
// itself: a useReduceMotion() call here would read the context from above MotionConfig. The Stack
// that reads the answer is AppStack, rendered below.
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SessionProvider } from '@/services/session/session-context';
import { NavigationThemeProvider } from '@/theme/navigation-theme';
import { MotionConfig } from '@/ui/a11y/motion-config';

import { AppStack } from './app-stack';

import type { SessionManager } from '@/services/session/session-types';

export type RootStackProps = {
  /** The app's one session (AppRoot creates it); every route below reads it through context. */
  readonly session: SessionManager;
};

export function RootStack({ session }: RootStackProps): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <MotionConfig preference="system">
        <NavigationThemeProvider>
          <SessionProvider session={session}>
            <AppStack />
          </SessionProvider>
        </NavigationThemeProvider>
      </MotionConfig>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
