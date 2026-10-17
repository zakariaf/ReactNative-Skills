// src/features/parity/parity-error-screen.tsx
// What a refused parity launch shows instead of any screen: its root testID parity.error, the failure
// as its label, so capture-app.mjs reports screen-not-reached naming the bad parameter. Test-only
// (reached through the parity launch route); the message is a technical line, never catalog copy.
import { StyleSheet, View } from 'react-native';

import { CONTENT_MAX_WIDTH } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';

import type { ReactNode } from 'react';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});

export type ParityErrorScreenProps = {
  readonly message: string;
};

export function ParityErrorScreen({ message }: ParityErrorScreenProps): ReactNode {
  return (
    <View testID="parity.error" accessible accessibilityLabel={message} style={styles.root}>
      <AppText>{message}</AppText>
    </View>
  );
}
