// src/ui/motion/use-motion-loop.ts
// The only way the app loops an animation (an attention moment: a syncing pulse, a waiting hint).
// A loop runs on the UI thread until something stops it, so it stops here when the screen is not
// focused (a pushed screen keeps the one below it mounted), when the app is not in the foreground,
// and when motion is reduced. Reanimated reads the reduce-motion setting once, when an animation
// starts, so a loop already running when the setting turns on would keep going; the effect below
// cancels it and the phase rests at 0, which is what reduce motion shows.
import { useEffect } from 'react';
import { cancelAnimation, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useIsAppActive } from '@/hooks/use-is-app-active';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { timingOf } from './moment-config';

import type { MotionMoment } from './motion-moments';
import type { SharedValue } from 'react-native-reanimated';

/** What the screen's model hook knows that this hook cannot read itself. */
export type LoopGates = {
  /** useIsFocused() from expo-router (React Navigation 7: @react-navigation/native). */
  readonly isFocused: boolean;
};

/** The three facts that decide whether a loop may run. */
export type LoopFacts = {
  readonly isFocused: boolean;
  readonly isAppActive: boolean;
  readonly isReducedMotion: boolean;
};

/** A loop runs only while its screen is focused, the app is active and motion is not reduced. */
export function loopRunsWhen(facts: LoopFacts): boolean {
  return facts.isFocused && facts.isAppActive && !facts.isReducedMotion;
}

/**
 * A phase that swings 0 → 1 → 0 over the moment's duration while the loop may run, and rests at 0
 * otherwise. Read it in an animated style.
 */
export function useMotionLoop(moment: MotionMoment, gates: LoopGates): SharedValue<number> {
  const isRunning = loopRunsWhen({
    isFocused: gates.isFocused,
    isAppActive: useIsAppActive(),
    isReducedMotion: useReduceMotion(),
  });
  const phase = useSharedValue(0);
  useEffect(() => {
    if (!isRunning) {
      cancelAnimation(phase);
      phase.set(0);
      return undefined;
    }
    phase.set(withRepeat(withTiming(1, timingOf(moment)), -1, true));
    return () => {
      cancelAnimation(phase);
    };
  }, [isRunning, moment, phase]);
  return phase;
}
