// src/features/sign-in/sign-in-screen.tsx
// The sign-in screen, a pure view of its props.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { SignInModel } from './use-sign-in-model';

export type SignInScreenProps = SignInModel;

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: 'center',
      gap: SPACING.lg,
      paddingInline: SPACING.lg,
      backgroundColor: theme.colors.background,
    },
    column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', gap: SPACING.md },
  });
  return styles;
});

export function SignInScreen(props: SignInScreenProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View testID="sign-in.screen" style={styles.screen}>
      <View style={styles.column}>
        <AppText variant="title" isHeader>
          {props.title}
        </AppText>
        <PressableSurface
          testID="sign-in.continue-button"
          label={props.continueLabel}
          onPress={props.onContinue}
          radius={RADII.md}
          fill={theme.colors.primary}
          isReducedMotion={props.isReducedMotion}
          isBusy={props.isWorking}
        >
          <AppText tone="onPrimary">{props.continueLabel}</AppText>
        </PressableSurface>
        {props.errorText === null ? null : (
          <AppText testID="sign-in.error" tone="danger">
            {props.errorText}
          </AppText>
        )}
      </View>
    </View>
  );
}
