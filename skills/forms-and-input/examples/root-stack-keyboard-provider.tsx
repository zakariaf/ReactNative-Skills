// src/features/root-navigator/root-stack.tsx (shape: the one provider forms-and-input adds)
// KeyboardProvider sits inside GestureHandlerRootView and outside the motion config and the
// navigation theme, so every screen below can use KeyboardAwareScrollView, KeyboardStickyView and
// useKeyboardState. The order of the other providers is navigation-and-routing's; keep it.
// Edit the app's existing root-stack.tsx: add the KeyboardProvider import and element only, and keep
// that file's own header (its line-2 "// device-only: ..." marker, which unit-and-component-tests'
// device-only convention reads, and its provider comments). Never paste this shape over it.
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { NavigationThemeProvider } from '@/theme/navigation-theme';
import { MotionConfig } from '@/ui/a11y/motion-config';

import { AppStack } from './app-stack';

export function RootStack(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <MotionConfig preference="system">
          <NavigationThemeProvider>
            <AppStack />
          </NavigationThemeProvider>
        </MotionConfig>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
