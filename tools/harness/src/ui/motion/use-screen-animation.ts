// src/ui/motion/use-screen-animation.ts
// The native stack's screen animation, chosen from the app's reduce-motion answer. Stack
// transitions run in react-native-screens, which neither Reanimated's ReducedMotionConfig nor the
// in-app setting reaches (no reduce-motion handling in 4.26.2), so every Stack and every
// Stack.Screen that sets `animation` takes it from here.
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import type { StackAnimationTypes } from 'react-native-screens';

/** A cross-fade replaces any movement while motion is reduced; 'none' stays 'none'. */
export function screenAnimationFor(
  isReducedMotion: boolean,
  normal: StackAnimationTypes = 'default',
): StackAnimationTypes {
  if (!isReducedMotion || normal === 'none') return normal;
  return 'fade';
}

/** The animation for screenOptions or a Stack.Screen's options: `normal` unless motion is reduced. */
export function useScreenAnimation(normal: StackAnimationTypes = 'default'): StackAnimationTypes {
  return screenAnimationFor(useReduceMotion(), normal);
}
