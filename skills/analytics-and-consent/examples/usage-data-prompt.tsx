// src/features/settings/components/usage-data-prompt.tsx
// The opt-in prompt, a pure view (a shape). It says what is collected and why in plain words, offers
// two equal choices (same size, same weight, same paint, neither pre-selected), and names where to
// change it later. Nothing in the app depends on the answer. The buttons are the shared
// PressableSurface (ui-component-library): its layoutStyle places the control in the row.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

export type UsageDataPromptProps = {
  /** Translated: what is sent (which screens and features are used), never what you type. */
  readonly body: string;
  readonly shareLabel: string;
  readonly declineLabel: string;
  /** From the app's reduce-motion hook, via the screen model. */
  readonly isReducedMotion: boolean;
  readonly onShare: () => void;
  readonly onDecline: () => void;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    card: { gap: SPACING.md, padding: SPACING.lg, backgroundColor: theme.colors.background },
    actions: { flexDirection: 'row', gap: SPACING.sm },
    action: { flex: 1 },
    face: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  });
  return styles;
});

export function UsageDataPrompt(props: UsageDataPromptProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View testID="settings.usage-data-prompt" style={styles.card}>
      <AppText variant="body">{props.body}</AppText>
      <View style={styles.actions}>
        <PressableSurface
          testID="settings.usage-data-prompt.decline"
          label={props.declineLabel}
          onPress={props.onDecline}
          radius={RADII.md}
          fill={theme.colors.surface}
          isReducedMotion={props.isReducedMotion}
          accessibilityRole="button"
          layoutStyle={styles.action}
          faceStyle={styles.face}
        >
          <AppText variant="label">{props.declineLabel}</AppText>
        </PressableSurface>
        <PressableSurface
          testID="settings.usage-data-prompt.share"
          label={props.shareLabel}
          onPress={props.onShare}
          radius={RADII.md}
          fill={theme.colors.surface}
          isReducedMotion={props.isReducedMotion}
          accessibilityRole="button"
          layoutStyle={styles.action}
          faceStyle={styles.face}
        >
          <AppText variant="label">{props.shareLabel}</AppText>
        </PressableSurface>
      </View>
    </View>
  );
}
