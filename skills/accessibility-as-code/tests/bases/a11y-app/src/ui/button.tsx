// src/ui/button.tsx
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { AppText } from './app-text';
import { MIN_TOUCH_TARGET } from './touch-size';

import type { ReactNode } from 'react';

export type ButtonProps = {
  /** Already translated; also the accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  /** Translated, only when the result of the tap is not obvious from the label. */
  readonly hint?: string;
  readonly isDisabled?: boolean;
  readonly isBusy?: boolean;
};

const styles = StyleSheet.create({
  base: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, paddingInline: 16 },
  pressed: { opacity: 0.8 },
  inactive: { opacity: 0.5 },
});

export function Button(props: ButtonProps): ReactNode {
  const { label, onPress, testID, isDisabled = false, isBusy = false } = props;
  const isInactive = isDisabled || isBusy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(props.hint === undefined ? {} : { accessibilityHint: props.hint })}
      accessibilityState={{ disabled: isInactive, busy: isBusy }}
      disabled={isInactive}
      onPress={onPress}
      style={(state) => [styles.base, state.pressed && styles.pressed, isInactive && styles.inactive]}
      testID={testID}
    >
      {isBusy ? <ActivityIndicator /> : <AppText text={label} />}
    </Pressable>
  );
}
