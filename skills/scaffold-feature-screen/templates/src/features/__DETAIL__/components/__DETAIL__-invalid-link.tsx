// src/features/__DETAIL__/components/__DETAIL__-invalid-link.tsx
// The invalid-link state: one sentence on why, never the URL itself (it can hold anything), and the
// one way out. Presentational: every text arrives translated and every testID comes from the screen.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

export type __DETAIL_PASCAL__InvalidLinkProps = {
  /** Translated: why the link opens nothing. */
  readonly text: string;
  /** Translated: the label of the way out. */
  readonly goHomeLabel: string;
  readonly onGoHome: () => void;
  /** From the app's reduce-motion hook, via the screen model. */
  readonly isReducedMotion: boolean;
  readonly textTestID: string;
  readonly buttonTestID: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    block: { gap: SPACING.md },
    action: { paddingBlock: SPACING.md, paddingInline: SPACING.lg, alignItems: 'center' },
  });
  return { ...styles, actionFill: theme.colors.primary };
});

export function __DETAIL_PASCAL__InvalidLink(
  props: __DETAIL_PASCAL__InvalidLinkProps,
): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.block}>
      <AppText testID={props.textTestID}>{props.text}</AppText>
      <PressableSurface
        testID={props.buttonTestID}
        label={props.goHomeLabel}
        onPress={props.onGoHome}
        radius={RADII.md}
        fill={styles.actionFill}
        isReducedMotion={props.isReducedMotion}
        accessibilityRole="button"
        faceStyle={styles.action}
      >
        <AppText tone="onPrimary">{props.goHomeLabel}</AppText>
      </PressableSurface>
    </View>
  );
}
