// src/features/debug/debug-menu-screen.tsx: the debug menu, a pure view of its props. A short,
// fixed list, so a ScrollView; every row is the app's one press surface with its own testID.
import { ScrollView, StyleSheet } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { DebugMenuModel } from './use-debug-menu-model';

export type DebugMenuScreenProps = DebugMenuModel;

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      gap: SPACING.sm,
      paddingBlock: SPACING.lg,
      paddingInline: SPACING.lg,
    },
    face: { paddingBlock: SPACING.md, paddingInline: SPACING.lg },
  });
  return styles;
});

export function DebugMenuScreen(props: DebugMenuScreenProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  return (
    // bounded-list: three switches and two actions, fixed in code; the menu never grows with data.
    <ScrollView testID="debug.menu" style={styles.root} contentContainerStyle={styles.content}>
      <AppText testID="debug.menu.build" tone="muted">
        {props.buildText}
      </AppText>
      <AppText testID="debug.menu.day">{props.dayText}</AppText>
      <AppText testID="debug.menu.errors" tone="muted">
        {props.errorsText}
      </AppText>
      {props.switches.map((row) => (
        <PressableSurface
          key={row.id}
          label={row.label}
          onPress={row.onToggle}
          testID={`debug.menu.${row.id}`}
          radius={RADII.md}
          fill={theme.colors.surface}
          isReducedMotion={props.isReducedMotion}
          accessibilityRole="switch"
          isChecked={row.isOn}
          faceStyle={styles.face}
        >
          <AppText>{row.label}</AppText>
        </PressableSurface>
      ))}
      {props.actions.map((action) => (
        <PressableSurface
          key={action.id}
          label={action.label}
          onPress={action.onPress}
          testID={`debug.menu.${action.id}`}
          radius={RADII.md}
          fill={theme.colors.surface}
          isReducedMotion={props.isReducedMotion}
          accessibilityRole="button"
          faceStyle={styles.face}
        >
          <AppText>{action.label}</AppText>
        </PressableSurface>
      ))}
    </ScrollView>
  );
}
