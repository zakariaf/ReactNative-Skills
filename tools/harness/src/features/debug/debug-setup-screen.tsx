// src/features/debug/debug-setup-screen.tsx: the debug-link screen, a pure view of its props. Flows
// wait for the target screen's testID after a link; debug.setup-error fails them fast instead.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';

export type DebugSetupScreenProps = {
  /** Translated: "Applying the debug link" or why it was refused. */
  readonly label: string;
  readonly isFailed: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'center',
      paddingInline: SPACING.lg,
      backgroundColor: theme.colors.background,
    },
    content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  });
  return styles;
});

export function DebugSetupScreen({ label, isFailed }: DebugSetupScreenProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <AppText
          testID={isFailed ? 'debug.setup-error' : 'debug.setup'}
          tone={isFailed ? 'danger' : 'muted'}
        >
          {label}
        </AppText>
      </View>
    </View>
  );
}
