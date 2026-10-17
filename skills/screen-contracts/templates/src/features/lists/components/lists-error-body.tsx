// src/features/lists/components/lists-error-body.tsx
// The Lists screen's error state (Chosen): the message, a growing spacer, and the state's one action
// at the bottom of the column. The column scrolls at 200 % text instead of clipping the action.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';
import { ScreenBody } from '@/ui/screen-body';

export type ListsErrorBodyProps = {
  /** Translated. */
  readonly text: string;
  /** Translated; also the button's accessible name. */
  readonly retryLabel: string;
  readonly onRetry: () => void;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    grow: { flexGrow: 1 },
    face: { paddingBlock: SPACING.md, paddingInline: SPACING.lg, alignItems: 'center' },
  });
  return styles;
});

export function ListsErrorBody(props: ListsErrorBodyProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <ScreenBody isUnderHomeIndicator>
      <AppText testID="lists.error-note" tone="danger">
        {props.text}
      </AppText>
      <View style={styles.grow} />
      <PressableSurface
        testID="lists.retry-button"
        label={props.retryLabel}
        onPress={props.onRetry}
        radius={RADII.md}
        fill={theme.colors.primary}
        isReducedMotion={props.isReducedMotion}
        accessibilityRole="button"
        faceStyle={styles.face}
      >
        <AppText tone="onPrimary" variant="label">
          {props.retryLabel}
        </AppText>
      </PressableSurface>
    </ScreenBody>
  );
}
