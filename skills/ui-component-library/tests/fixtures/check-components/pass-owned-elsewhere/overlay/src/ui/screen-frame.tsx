// src/ui/screen-frame.tsx
// Every screen's outermost view: the safe areas, the ground colour behind the system bars, and a
// centred column capped at CONTENT_MAX_WIDTH for wide windows. Android 16 draws every app edge to
// edge, so the insets matter on both platforms. The SafeAreaView of react-native-safe-area-context
// applies the insets of its nearest provider, not of its own position, and Expo Router's navigators
// reuse the root provider's insets. A navigator header already pads the top inset and the JS tab bar
// pads the bottom one, so each screen names what sits around it: an edge the frame shares with a
// header or a tab bar is left off, or that inset is added twice.
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH } from '@/theme/tokens';

import type { ReactNode } from 'react';
import type { Edge } from 'react-native-safe-area-context';

/** Nothing above or below (headerShown: false, a full-screen modal): every edge. */
export const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/** A navigator header above, nothing below: the header already clears the status bar and the notch. */
export const BELOW_HEADER_EDGES: readonly Edge[] = ['right', 'bottom', 'left'];

/** A tab screen without a header: the tab bar below already clears the home indicator or nav bar. */
export const ABOVE_TAB_BAR_EDGES: readonly Edge[] = ['top', 'right', 'left'];

/** A tab screen with a header (the Tabs default): both bars clear their own system bar. */
export const BETWEEN_HEADER_AND_TAB_BAR_EDGES: readonly Edge[] = ['right', 'left'];

export type ScreenFrameProps = {
  /** `<screen>.screen`, the first testID of every screen. */
  readonly testID: string;
  /**
   * Required, so every screen states what sits around it (one of the four sets above). Physical
   * edges on purpose: the notch, camera cutout and gesture bar do not mirror in RTL.
   */
  readonly edges: readonly Edge[];
  readonly children: ReactNode;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    // The ground fills the whole window, behind the status bar and the home indicator too.
    root: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center' },
    // No padding here: the screen's header and body apply their own spacing tokens.
    column: { flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH },
  });
  return styles;
});

export function ScreenFrame({ testID, edges, children }: ScreenFrameProps): ReactNode {
  const styles = useStyles();
  return (
    <SafeAreaView edges={edges} style={styles.root} testID={testID}>
      <View style={styles.column}>{children}</View>
    </SafeAreaView>
  );
}
