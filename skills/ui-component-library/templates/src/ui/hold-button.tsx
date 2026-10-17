// src/ui/hold-button.tsx
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';
import { useHoldToConfirm } from './use-hold-to-confirm';

import type { ReactNode } from 'react';
import type { AccessibilityActionEvent } from 'react-native';

const BUTTON = COMPONENT_SPECS.button;
const PERCENT = 100;
const ACTIONS = [{ name: 'activate' }] as const;

export type HoldButtonProps = {
  /** Translated ("Hold to delete all tasks"). */
  readonly label: string;
  /** Translated ("Hold for 2 seconds"); also shown as a caption under the button by the screen. */
  readonly hint: string;
  readonly onConfirm: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  /** 0 to 1: a still fill with no timer (a screenshot of the held state). Read at mount. */
  readonly frozenProgress?: number;
};

const styles = StyleSheet.create({
  face: {
    minHeight: BUTTON.minHeight,
    paddingBlock: BUTTON.paddingBlock,
    paddingInline: BUTTON.paddingInline,
    flexDirection: 'row',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // The fill grows from the start edge while the finger is down, and its share is of the whole
  // face. Yoga resolves an absolute child's percentage width inside its parent's padding, so a fill
  // placed straight in the face stops short by the padding: it lives in a track pinned to the edges.
  fillTrack: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row' },
  fill: { alignSelf: 'stretch' },
  block: { alignSelf: 'stretch' },
});

function ignoreTap(): void {
  // A short tap does nothing: only a completed hold, or the screen reader's activate, confirms.
}

/**
 * A destructive block button that confirms after a hold. Screen-reader users confirm with the
 * activate action (a double tap), so the hold is never the only way.
 */
export function HoldButton(props: HoldButtonProps): ReactNode {
  const theme = useTheme();
  const hold = useHoldToConfirm(props.onConfirm, props.frozenProgress);
  const fillStyle = useAnimatedStyle(() => ({
    // motion-layout: an absolutely positioned, childless fill inside its track
    width: `${String(hold.progress.get() * PERCENT)}%`,
  }));
  const handleAction = (event: AccessibilityActionEvent): void => {
    if (event.nativeEvent.actionName === 'activate') props.onConfirm();
  };
  return (
    <PressableSurface
      label={props.label}
      hint={props.hint}
      onPress={ignoreTap}
      onPressIn={hold.handlePressIn}
      onPressOut={hold.handlePressOut}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={handleAction}
      testID={props.testID}
      radius={BUTTON.radius}
      fill={theme.colors.surface}
      edgeColor={theme.colors.danger}
      edgeWidth={BUTTON.border}
      isReducedMotion={props.isReducedMotion}
      faceStyle={styles.face}
      layoutStyle={styles.block}
    >
      <View style={styles.fillTrack} pointerEvents="none">
        <Animated.View
          style={[styles.fill, { backgroundColor: theme.colors.dangerSurface }, fillStyle]}
          testID={`${props.testID}.fill`}
        />
      </View>
      <AppText variant="buttonLabel" tone="danger" align="center">
        {props.label}
      </AppText>
    </PressableSurface>
  );
}
