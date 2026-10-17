// src/ui/toast-stack.tsx
import { StyleSheet, View } from 'react-native';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const TOAST = COMPONENT_SPECS.toast;

export type ToastStackProps = {
  readonly testID: string;
  /** Toasts, newest last, each keyed by its message id. */
  readonly children: ReactNode;
};

const styles = StyleSheet.create({ stack: { alignSelf: 'stretch', gap: TOAST.stackGap } });

/** Stacks toasts that are on screen together (a result after a progress message). */
export function ToastStack({ testID, children }: ToastStackProps): ReactNode {
  return (
    <View style={styles.stack} testID={testID}>
      {children}
    </View>
  );
}
