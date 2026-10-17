// src/features/tasks/components/task-summary-card.tsx
// Example (a shape to imitate, not a template): a flat information card with one pressable action,
// built only from the theme. The card lies flat (an edge, no shadow); the one pressable part is the
// press surface, whose press look comes from PRESS; numbers use the tabular statValue style; every
// colour is a role.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING, STROKE } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { ReactNode } from 'react';

export type TaskSummaryCardProps = {
  /** Translated: "Due today". */
  readonly title: string;
  /** Formatted in the locale's digits: "4". */
  readonly count: string;
  /** Translated: "tasks left". */
  readonly countLabel: string;
  /** Translated: "Review tasks". */
  readonly actionLabel: string;
  readonly onAction: () => void;
  /** From the app's reduce-motion hook, via the screen model. */
  readonly isReducedMotion: boolean;
  readonly testID: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    card: {
      gap: SPACING.md,
      paddingBlock: SPACING.lg,
      paddingInline: SPACING.lg,
      borderRadius: RADII.lg,
      borderWidth: STROKE.hair,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    countRow: { flexDirection: 'row', alignItems: 'baseline', gap: SPACING.sm },
    rule: { borderTopWidth: STROKE.hair, borderTopColor: theme.colors.separator },
    actionFace: { paddingBlock: SPACING.sm, paddingInline: SPACING.lg },
  });
  return styles;
});

export function TaskSummaryCard(props: TaskSummaryCardProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.card} testID={props.testID}>
      <AppText variant="sectionHeading" isHeader>
        {props.title}
      </AppText>
      <View style={styles.countRow}>
        <AppText variant="statValue">{props.count}</AppText>
        <AppText variant="statLabel" tone="muted">
          {props.countLabel}
        </AppText>
      </View>
      <View style={styles.rule} />
      <PressableSurface
        label={props.actionLabel}
        onPress={props.onAction}
        testID={`${props.testID}.action-button`}
        radius={RADII.md}
        fill={theme.colors.primary}
        edgeColor={theme.colors.primary}
        isReducedMotion={props.isReducedMotion}
        faceStyle={styles.actionFace}
      >
        <AppText variant="buttonLabel" tone="onPrimary" align="center">
          {props.actionLabel}
        </AppText>
      </PressableSurface>
    </View>
  );
}
