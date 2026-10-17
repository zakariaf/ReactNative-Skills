// src/features/not-found/not-found-screen.tsx: what an unknown URL shows, a pure view of its props.
// One way out: the button takes the person to the app's first screen.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, RADII, SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

export type NotFoundScreenProps = {
  /** Translated: "Page not found". */
  readonly title: string;
  /** Translated: one sentence on why, never the URL itself (it can hold anything). */
  readonly body: string;
  /** Translated: "Go to your tasks". */
  readonly goHomeLabel: string;
  readonly onGoHome: () => void;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: 'center',
      backgroundColor: theme.colors.background,
      paddingInline: SPACING.lg,
    },
    content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', gap: SPACING.md },
    action: { paddingBlock: SPACING.md, paddingInline: SPACING.lg, alignItems: 'center' },
  });
  return { ...styles, actionFill: theme.colors.primary };
});

export function NotFoundScreen(props: NotFoundScreenProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <View testID="not-found.screen" style={styles.screen}>
      <View style={styles.content}>
        <AppText testID="not-found.title" variant="title" isHeader>
          {props.title}
        </AppText>
        <AppText testID="not-found.body" tone="muted">
          {props.body}
        </AppText>
        <PressableSurface
          testID="not-found.go-home-button"
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
    </View>
  );
}
