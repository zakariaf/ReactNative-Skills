// src/features/root-navigator/root-stack.tsx
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AppStack } from './app-stack';

export function RootStack(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <AppStack />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
