// src/ui/busy-indicator.tsx
// Example (a shape to imitate): the BusyIndicator to use instead of the template once the app has
// motion-and-animation's moment catalogue (src/ui/motion/). The wave plays through useMotionLoop, so
// it stops while the screen is covered, while the app is in the background and when motion is
// reduced, and it cancels a running loop when any of that changes; the template's own withRepeat
// cannot. Declare the moment first:
//   busyWave: { kind: 'attention', trigger: 'Work in progress: a busy button, a busy toast or a lone
//     indicator', timing: { duration: 'slow', easing: 'linear' }, reduced: 'static' }
// The props stay the same, so Button and Toast need no change; isReducedMotion is kept for them and
// is no longer read here (the hook reads reduce motion itself).
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';
import { useMotionLoop } from '@/ui/motion/use-motion-loop';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

const BUSY = COMPONENT_SPECS.busy;
/** Each block is a third of a loop behind the one before it, so the three make a wave. */
const STAGGER = 1 / 3;

export type BusyIndicatorProps = {
  /** The colour of the text it sits beside (a button label, a toast). */
  readonly color: string;
  /** Kept for the callers; useMotionLoop reads reduce motion itself. */
  readonly isReducedMotion: boolean;
  /**
   * False while another screen covers this one (the screen model passes useIsFocused()). It may be
   * left out: the indicator shows only while work runs, and the app being in the background or
   * motion being reduced still stops it.
   */
  readonly isFocused?: boolean;
  /** Translated ("Loading"): a labelled image when it stands alone; hidden inside a control. */
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

/** Three hopping blocks: work in progress. The phase swings 0 → 1 → 0, so the wave runs back and forth. */
export function BusyIndicator(props: BusyIndicatorProps): ReactNode {
  const phase = useMotionLoop(MOTION_MOMENTS.busyWave, { isFocused: props.isFocused ?? true });
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
