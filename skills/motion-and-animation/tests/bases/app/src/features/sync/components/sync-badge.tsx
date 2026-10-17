// src/features/sync/components/sync-badge.tsx
// The syncing dot: an attention loop that stops off screen, in the background and when motion is
// reduced (useMotionLoop), resting fully visible.
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
