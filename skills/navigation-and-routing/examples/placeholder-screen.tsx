// src/features/placeholder/placeholder-screen.tsx (a shape to imitate, not a template)
// While an app is built screen by screen, a route whose screen is not ready renders this, so the whole
// route table, its typed hrefs and every model hook's navigation exist from the first day; no no-op
// handlers. The route stays thin and the model hook (use-placeholder-model.ts: useT() for the label,
// useRouter() for back, useReduceMotion() for the press feedback) is the only code that reads copy
// and navigation:
//
//   // src/app/(app)/stats.tsx
//   import { PlaceholderScreen } from '@/features/placeholder/placeholder-screen';
//   import { usePlaceholderModel } from '@/features/placeholder/use-placeholder-model';
//
//   export default function StatsRoute(): React.JSX.Element {
//     const model = usePlaceholderModel();
//     return (
//       <PlaceholderScreen
//         routeName="stats"
//         backLabel={model.backLabel}
//         onBack={model.onBack}
//         isReducedMotion={model.isReducedMotion}
//       />
//     );
//   }
//
// List the route in contracts/navigation.json "placeholders"; check-navigation --release fails while
// any is left. The view uses react-components-and-hooks' ScreenFrame with the edges of its header
// (BELOW_HEADER_EDGES under the native header), the library's PressableSurface for Back (press
// feedback, a label and the minimum target size, as the not-found screen does) and only existing
// message keys (common.back).
import { StyleSheet } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';
import { BELOW_HEADER_EDGES, ScreenFrame } from '@/ui/screen-frame';

export type PlaceholderScreenProps = {
  /** The route's own name, shown so a tester knows where the link went (not translated: a dev aid). */
  readonly routeName: string;
  /** Translated "Back". */
  readonly backLabel: string;
  readonly onBack: () => void;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    action: { paddingBlock: SPACING.md, paddingInline: SPACING.lg, alignItems: 'center' },
  });
  return { ...styles, actionFill: theme.colors.primary };
});

export function PlaceholderScreen(props: PlaceholderScreenProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <ScreenFrame testID="placeholder.screen" edges={BELOW_HEADER_EDGES}>
      <AppText testID="placeholder.route-name" tone="muted">
        {props.routeName}
      </AppText>
      <PressableSurface
        testID="placeholder.back-button"
        label={props.backLabel}
        onPress={props.onBack}
        radius={RADII.md}
        fill={styles.actionFill}
        isReducedMotion={props.isReducedMotion}
        accessibilityRole="button"
        faceStyle={styles.action}
      >
        <AppText tone="onPrimary">{props.backLabel}</AppText>
      </PressableSurface>
    </ScreenFrame>
  );
}
