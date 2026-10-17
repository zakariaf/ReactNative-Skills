// src/ui/icon-button.tsx
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from './icon';
import { MIN_TOUCH_TARGET } from './touch-size';

import type { ReactNode } from 'react';

export type IconButtonProps = {
  readonly icon: string;
  /** Required: an icon-only button has no visible text for the screen reader to read. */
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
};

const styles = StyleSheet.create({
  // The touch box itself is 44 x 44 pt; the 24 pt glyph sits in the middle. No hitSlop.
  box: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
});

export function IconButton({ icon, label, onPress, testID }: IconButtonProps): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.box}
      testID={testID}
    >
      <Icon name={icon} />
    </Pressable>
  );
}
