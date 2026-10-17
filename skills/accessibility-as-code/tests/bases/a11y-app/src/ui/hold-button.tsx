// src/ui/hold-button.tsx
import { Pressable, StyleSheet } from 'react-native';

import { useHoldToConfirm } from './use-hold-to-confirm';

import type { ReactNode } from 'react';

const styles = StyleSheet.create({ key: { minHeight: 48, minWidth: 48 } });

export function HoldButton({ label, onConfirm }: { readonly label: string; readonly onConfirm: () => void }): ReactNode {
  const hold = useHoldToConfirm(onConfirm);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={onConfirm}
      onPressIn={hold.handlePressIn}
      onPressOut={hold.handlePressOut}
      style={styles.key}
    />
  );
}
