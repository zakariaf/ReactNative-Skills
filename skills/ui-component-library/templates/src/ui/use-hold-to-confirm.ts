// src/ui/use-hold-to-confirm.ts
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { MOTION_MS } from '@/theme/motion';

import type { SharedValue } from 'react-native-reanimated';

/** How long the finger must stay down (the motion token holdToConfirm). */
export const HOLD_TO_CONFIRM_MS = MOTION_MS.holdToConfirm;

export type HoldToConfirm = {
  /** 0..1 fill for the button face; read it in an animated style. */
  readonly progress: SharedValue<number>;
  readonly handlePressIn: () => void;
  readonly handlePressOut: () => void;
};

/** A frozen fill stays between empty (0) and full (1). */
function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * The hold behind a destructive key: the fill grows while the finger stays down and confirms once
 * it is full; lifting early empties it. The timer passes ReduceMotion.Never because it is a safety
 * timer, not decoration: under Reduce Motion Reanimated would otherwise finish it at once and the
 * hold would confirm on touch. `frozenProgress` (0 to 1, read at mount) holds a still fill with no
 * timer, for a screenshot of the held state; screen readers confirm through the activate action.
 */
export function useHoldToConfirm(onConfirm: () => void, frozenProgress?: number): HoldToConfirm {
  const isFrozen = frozenProgress !== undefined;
  const progress = useSharedValue(isFrozen ? clampUnit(frozenProgress) : 0);
  const handlePressIn = (): void => {
    if (isFrozen) return;
    const config = {
      duration: HOLD_TO_CONFIRM_MS,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.Never,
    };
    progress.set(
      withTiming(1, config, (isFinished) => {
        if (isFinished === true) scheduleOnRN(onConfirm);
      }),
    );
  };
  const handlePressOut = (): void => {
    if (isFrozen) return;
    cancelAnimation(progress);
    progress.set(withTiming(0, { duration: MOTION_MS.fast }));
  };
  return { progress, handlePressIn, handlePressOut };
}
