// src/features/root-navigator/root-stack.tsx
// device-only: covered by the app launch on a device (it only composes the tested RootMotion, NavigationThemeProvider and AppStack)
// The providers above the root Stack, in the canonical order (app-startup-and-bootstrap), rendered by
// AppRoot inside its providers (it lives in its own file because those fill the JSX depth the lint
// allows): GestureHandlerRootView, the one gesture root every gesture and gesture-driven canvas needs;
// KeyboardProvider (forms-and-input), so every keyboard-aware view and hook below gets real values;
// RootMotion, the app's one MotionConfig, which gives useReduceMotion() the reduce-motion preference
// ("system" until the app has the setting, then the saved choice PreferencesRoot provides above it)
// and sets Reanimated's global reduce-motion mode, or the registry's motion slot in its place (a test
// build's kit holds every animation still while its switch says so); and the navigation theme mapped
// from the app theme, so headers and screen backgrounds follow light and dark. Providers that apps add
// go in this order, each once: SessionProvider, AppFeedback, AdsRoot and GamesRoot inside the
// navigation theme. The optional kits of the app's registry ride along to RootMotion and AppStack,
// whose RootKits slot mounts their providers and effects around the Stack (a kit never edits this
// file, and neither does PreferencesRoot). It reads nothing itself: a
// useReduceMotion() call here would read the context from above MotionConfig. The Stack that reads
// the answer is AppStack, below.
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { NavigationThemeProvider } from '@/theme/navigation-theme';

import { AppStack } from './app-stack';
import { RootMotion } from './root-motion';

import type { RootKit } from '@/services/root-kits/root-kit';

export type RootStackProps = {
  /** The kits AppRoot's startApp created, for RootMotion and AppStack's slots (none: the Stack alone). */
  readonly kits: readonly RootKit[];
};

export function RootStack({ kits }: RootStackProps): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <RootMotion kits={kits}>
          <NavigationThemeProvider>
            <AppStack kits={kits} />
          </NavigationThemeProvider>
        </RootMotion>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
