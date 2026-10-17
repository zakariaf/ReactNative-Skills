// src/features/crash-recovery/crash-screen.tsx
// The fallback a crashed route shows: a title, one sentence and one way out. A pure view whose
// strings and background arrive as props. Under the root layout it renders outside every provider
// the layout mounts, so it reads no context that lacks a default. The app passes the background
// from useTheme(), whose context defaults to the light theme outside ThemeProvider: the same theme
// AppText falls back to, so text and background stay a pair whose contrast the theme proves. Keep
// it trivial (its one import beyond AppText is a token constant): no boundary catches an error thrown here, and React reports it to React Native as a
// fatal crash the error net never sees.
// press-outside-host: renders outside every provider, so the crash fallback stays trivial
import { Button, StyleSheet, View } from 'react-native';

import { CONTENT_MAX_WIDTH } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';

export type CrashScreenProps = {
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  /**
   * The screen background, from useTheme() (its context defaults to the light theme outside
   * ThemeProvider), so it always matches the theme AppText draws the text with.
   */
  readonly backgroundColor: string;
};

/** Crash fallback: one way out, never an automatic retry. */
export function CrashScreen({
  title,
  body,
  actionLabel,
  onAction,
  backgroundColor,
}: CrashScreenProps): React.JSX.Element {
  return (
    <View
      testID="crash.screen"
      style={[styles.screen, { backgroundColor }]}
      accessibilityRole="alert"
    >
      <View style={styles.column}>
        <AppText testID="crash.title">{title}</AppText>
        <AppText testID="crash.body">{body}</AppText>
        <Button testID="crash.restart-button" title={actionLabel} onPress={onAction} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  // A readable line on a wide window (a tablet in landscape): a constant, so no context is read.
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: 16 },
});
