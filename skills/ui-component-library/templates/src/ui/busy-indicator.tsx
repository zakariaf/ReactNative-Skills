// src/ui/busy-indicator.tsx
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { MOTION_MS } from '@/theme/motion';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

const BUSY = COMPONENT_SPECS.busy;
/** One loop of the wave (the slow motion token); each block rises and falls once per loop. */
const LOOP = { duration: MOTION_MS.slow, easing: Easing.linear };
/** Each block is a third of a loop behind the one before it, so the three make a wave. */
const STAGGER = 1 / 3;

export type BusyIndicatorProps = {
  /** The colour of the text it sits beside (a button label, a toast). */
  readonly color: string;
  readonly isReducedMotion: boolean;
  /**
   * Translated ("Loading"): the indicator stands alone and is a labelled image. Leave it out inside
   * a busy button or toast: the control's label and its busy state already say it, so it hides.
   */
  readonly label?: string;
  readonly testID?: string;
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: BUSY.gap, paddingTop: BUSY.hop },
  block: { width: BUSY.block, height: BUSY.block, borderRadius: BUSY.radius },
});

/** A block's lift (0..1) at a loop phase: up for the first half of its own turn, down for the second. */
function liftAt(phase: number, index: number): number {
  'worklet';
  const own = (phase - index * STAGGER + 1) % 1;
  return 1 - Math.abs(own * 2 - 1);
}

/** Labelled image when it stands alone; hidden inside a control that already says it is busy. */
function a11yOf(props: BusyIndicatorProps): ViewProps {
  const id = props.testID === undefined ? {} : { testID: props.testID };
  if (props.label === undefined) {
    return {
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
      ...id,
    };
  }
  return {
    accessible: true,
    accessibilityRole: 'image',
    accessibilityLabel: props.label,
    accessibilityState: { busy: true },
    ...id,
  };
}

/** Three hopping blocks: work in progress. Still under reduce motion (a loop is motion). */
export function BusyIndicator(props: BusyIndicatorProps): ReactNode {
  const { isReducedMotion } = props;
  const phase = useSharedValue(0);
  // Allowed effect: starts and stops an animation loop, sets no React state.
  useEffect(() => {
    if (isReducedMotion) return undefined;
    phase.set(withRepeat(withTiming(1, LOOP), -1));
    return () => {
      cancelAnimation(phase);
    };
  }, [isReducedMotion, phase]);
  const first = useAnimatedStyle(() => ({
    transform: [{ translateY: -liftAt(phase.get(), 0) * BUSY.hop }],
  }));
  const second = useAnimatedStyle(() => ({
    transform: [{ translateY: -liftAt(phase.get(), 1) * BUSY.hop }],
  }));
  const third = useAnimatedStyle(() => ({
    transform: [{ translateY: -liftAt(phase.get(), 2) * BUSY.hop }],
  }));
  const paint = { backgroundColor: props.color };
  return (
    <View style={styles.row} {...a11yOf(props)}>
      <Animated.View style={[styles.block, paint, first]} />
      <Animated.View style={[styles.block, paint, second]} />
      <Animated.View style={[styles.block, paint, third]} />
    </View>
  );
}
