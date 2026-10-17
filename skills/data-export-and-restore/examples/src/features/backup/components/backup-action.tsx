// src/features/backup/components/backup-action.tsx: one Backup screen action that reports its own frame, so the iPad share popover points at it.
// A shape to imitate: the app's own copy uses its design system's button.
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { ShareAnchor } from '@/services/share-sheet/share-sheet-port';
import type { ComponentRef } from 'react';

type HostView = ComponentRef<typeof View>;

export type BackupActionProps = {
  readonly testID: string;
  /** Translated by the model. */
  readonly label: string;
  /** Gets this action's frame in window coordinates (null before layout); a share passes it on. */
  readonly onPress: (anchor: ShareAnchor | null) => void;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: { paddingBlock: SPACING.md, paddingInline: SPACING.lg },
  });
  return styles;
});

/** Measures on press (an event handler), never during render. */
function measureAnchor(view: HostView | null, onPress: (anchor: ShareAnchor | null) => void): void {
  if (view === null) {
    onPress(null);
    return;
  }
  view.measureInWindow((...frame) => {
    const [x, y, width, height] = frame;
    onPress({ x, y, width, height });
  });
}

export function BackupAction(props: BackupActionProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useStyles();
  // One ref per action: the popover points at the action that was pressed.
  const frame = useRef<HostView>(null);
  const { label } = props;
  return (
    <View ref={frame}>
      <PressableSurface
        label={label}
        testID={props.testID}
        onPress={() => {
          measureAnchor(frame.current, props.onPress);
        }}
        radius={RADII.md}
        fill={theme.colors.surface}
        isReducedMotion={props.isReducedMotion}
        faceStyle={styles.face}
      >
        <AppText>{label}</AppText>
      </PressableSurface>
    </View>
  );
}
