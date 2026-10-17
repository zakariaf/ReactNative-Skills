// src/ui/chip.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const CHIP = COMPONENT_SPECS.chip;

export type ChipProps = {
  /** Translated ("Work", "Due today", "Step 2 of 4"). */
  readonly text: string;
  readonly testID: string;
  readonly icon?: IconSlot;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    // Hugs its text (alignSelf on itself); a screen centres it with a row wrapper.
    chip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: CHIP.gap,
      paddingBlock: CHIP.paddingBlock,
      paddingInline: CHIP.paddingInline,
      borderRadius: CHIP.radius,
      borderWidth: CHIP.border,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
  });
  return styles;
});

/**
 * A small flat label (a list name, a date, a step counter). Not interactive. The chip box is one
 * accessible text element with the testID, so its bounds are the chip's, not its words'.
 */
export function Chip({ text, testID, icon }: ChipProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View
      style={styles.chip}
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      {icon?.({ size: CHIP.icon, color: theme.colors.textMuted }) ?? null}
      <AppText variant="badge">{text}</AppText>
    </View>
  );
}
