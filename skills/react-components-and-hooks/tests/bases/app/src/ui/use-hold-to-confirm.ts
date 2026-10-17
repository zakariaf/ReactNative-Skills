// src/ui/use-hold-to-confirm.ts
// The press-and-hold behind a destructive control ("Delete all tasks"): the fill grows while the
// finger stays down and the action runs only when it reaches the end. The hold is a safety timer,
// not decoration, so it never shortens under reduce motion. Screen readers cannot hold: their
// 'activate' action (a double tap) confirms at once, so the control declares HOLD_TO_CONFIRM_ACTIONS.
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { MOTION_MS } from '@/theme/motion';

import type { AccessibilityActionEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

/** The control's accessibilityActions: VoiceOver and TalkBack fire 'activate' on a double tap. */
export const HOLD_TO_CONFIRM_ACTIONS = [{ name: 'activate' }] as const;

export type HoldToConfirmOptions = {
  /**
   * Holds the fill at this value (0 to 1, read at mount) with no timer, so a press neither fills
   * nor confirms: a screenshot of the held state. The screen-reader action still confirms.
   */
  readonly frozenProgress?: number;
};

export type HoldToConfirm = {
  /** 0..1 fill for the control's background; read it in an animated style. */
  readonly progress: SharedValue<number>;
  readonly handlePressIn: () => void;
  readonly handlePressOut: () => void;
  /** Pass as onAccessibilityAction next to accessibilityActions={HOLD_TO_CONFIRM_ACTIONS}. */
  readonly handleAccessibilityAction: (event: AccessibilityActionEvent) => void;
};

/** A frozen fill stays between empty (0) and full (1). */
function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function useHoldToConfirm(
  onConfirm: () => void,
  options: HoldToConfirmOptions = {},
): HoldToConfirm {
  const { frozenProgress } = options;
  const isFrozen = frozenProgress !== undefined;
  const progress = useSharedValue(isFrozen ? clampUnit(frozenProgress) : 0);
  const handlePressIn = (): void => {
    if (isFrozen) return;
    const hold = {
      duration: MOTION_MS.holdToConfirm,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.Never,
    };
    progress.set(
      withTiming(1, hold, (isFinished) => {
        if (isFinished === true) scheduleOnRN(onConfirm);
      }),
    );
  };
  const handlePressOut = (): void => {
    if (isFrozen) return;
    cancelAnimation(progress);
    progress.set(withTiming(0, { duration: MOTION_MS.fast, reduceMotion: ReduceMotion.Never }));
  };
  const handleAccessibilityAction = (event: AccessibilityActionEvent): void => {
    if (event.nativeEvent.actionName === 'activate') onConfirm();
  };
  return { progress, handlePressIn, handlePressOut, handleAccessibilityAction };
}
