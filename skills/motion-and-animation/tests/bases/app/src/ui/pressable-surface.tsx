// src/ui/pressable-surface.tsx
// Stand-in for design-system-structure's press surface: it animates the press and the release with
// motion tokens directly (it cannot import the catalog), so the catalog lists it in `files`.
import { Pressable } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { EASING, MOTION_MS, SPRINGS } from '@/theme/motion';

import type { ReactNode } from 'react';

const PRESS_IN = { duration: MOTION_MS.pressIn, easing: Easing.bezier(...EASING.decelerate) };

export type PressableSurfaceProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly children: ReactNode;
};

export function PressableSurface({ label, onPress, children }: PressableSurfaceProps): ReactNode {
  const depth = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: 1 - depth.get() / 4 }));
  function handlePressIn(): void {
    depth.set(withTiming(1, PRESS_IN));
  }
  function handlePressOut(): void {
    depth.set(withSpring(0, SPRINGS.release));
  }
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={style}>{children}</Animated.View>
    </Pressable>
  );
}
