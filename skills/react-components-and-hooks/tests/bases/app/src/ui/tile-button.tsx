// src/ui/tile-button.tsx: a pressable primitive; screens compose it, never a raw Pressable.
import { Pressable, StyleSheet } from 'react-native';

import type { ReactNode } from 'react';

export type TileButtonProps = {
  /** Translated by the model hook; also the accessibility label. */
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly hint?: string;
  readonly isDisabled?: boolean;
  readonly children: ReactNode;
};

const styles = StyleSheet.create({
  tile: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});

export function TileButton(props: TileButtonProps): ReactNode {
  const { label, onPress, testID, children } = props;
  const isDisabled = props.isDisabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(props.hint === undefined ? {} : { accessibilityHint: props.hint })}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={(state) => [styles.tile, state.pressed && styles.pressed]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}
