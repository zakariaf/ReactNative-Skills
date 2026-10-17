// src/features/sync/components/sync-badge.tsx
// Example (a shape to imitate): an attention loop. useMotionLoop stops it when the screen is not
// focused, the app is not active or motion is reduced, and restarts it when that changes; the rest
// state (phase 0, fully visible) is what reduce motion shows.
import { useIsFocused } from 'expo-router';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';
import { useMotionLoop } from '@/ui/motion/use-motion-loop';

import type { ReactNode } from 'react';

export function SyncBadge({ color }: { readonly color: string }): ReactNode {
  const phase = useMotionLoop(MOTION_MOMENTS.syncPulse, { isFocused: useIsFocused() });
  const style = useAnimatedStyle(() => ({ opacity: 1 - phase.get() / 2 }));
  return <Animated.View style={[{ backgroundColor: color }, style]} />;
}
