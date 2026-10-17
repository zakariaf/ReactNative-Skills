// src/features/tasks/components/task-card.tsx: a card that takes every value from the theme.
import { StyleSheet, View } from 'react-native';
import { withTiming } from 'react-native-reanimated';

import { makeStyles } from '@/theme/make-styles';
import { MOTION_MS } from '@/theme/motion';
import { shadow } from '@/theme/shadow-styles';
import { ELEVATION, RADII, SPACING, STROKE } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    card: {
      gap: SPACING.sm,
      padding: SPACING.lg,
      borderRadius: RADII.md,
      borderWidth: STROKE.hair,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      ...shadow(ELEVATION.raised, theme.colors.shadow),
    },
    flat: { borderRadius: 0 },
  });
  return styles;
});

export const FADE = () => withTiming(1, { duration: MOTION_MS.fast });

export function TaskCard({ title }: { readonly title: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.card, styles.flat]}>
      <AppText variant="rowLabel">{title}</AppText>
    </View>
  );
}
