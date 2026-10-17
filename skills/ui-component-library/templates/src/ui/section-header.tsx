// src/ui/section-header.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const HEADER = COMPONENT_SPECS.sectionHeader;

export type SectionHeaderProps = {
  /** Translated. */
  readonly title: string;
  readonly testID: string;
  readonly icon?: IconSlot;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: HEADER.gap,
      paddingTop: HEADER.paddingTop,
      paddingBottom: HEADER.paddingBottom,
      paddingInline: HEADER.paddingInline,
    },
  });
  return styles;
});

/**
 * The heading above a group of rows. The header View is the one accessible element and carries the
 * testID, so an E2E tool measures the whole header (icon and padding), not only its words.
 */
export function SectionHeader({ title, testID, icon }: SectionHeaderProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View
      style={styles.header}
      testID={testID}
      accessible
      accessibilityRole="header"
      accessibilityLabel={title}
    >
      {icon?.({ size: HEADER.icon, color: theme.colors.textMuted }) ?? null}
      <AppText variant="label" tone="muted">
        {title}
      </AppText>
    </View>
  );
}
