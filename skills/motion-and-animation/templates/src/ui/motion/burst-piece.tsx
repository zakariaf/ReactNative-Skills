// src/ui/motion/burst-piece.tsx
// One piece of a CelebrationBurst: it starts one stagger after the piece before it, flies out from
// the burst's centre along its own angle, shrinks and fades out by the end of the plan. Transform and
// opacity only, so a frame never re-runs layout.
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { RADII, SPACING } from '@/theme/tokens';

import type { CelebrationPlan } from './moment-config';
import type { ReactNode } from 'react';
import type { SharedValue } from 'react-native-reanimated';

/** How far a piece travels from the centre at the end of its flight. */
const TRAVEL = SPACING.xxl + SPACING.xl;

const styles = StyleSheet.create({
  piece: { position: 'absolute', width: SPACING.sm, height: SPACING.sm, borderRadius: RADII.sm },
});

/** 0 before the piece starts, 1 once it has settled; pieces start one stagger apart. */
export function pieceProgress(elapsedMs: number, index: number, plan: CelebrationPlan): number {
  'worklet';
  const start = plan.delayMs + index * plan.staggerMs;
  return Math.min(Math.max((elapsedMs - start) / plan.durationMs, 0), 1);
}

export type BurstPieceProps = {
  readonly index: number;
  readonly elapsedMs: SharedValue<number>;
  readonly plan: CelebrationPlan;
  /** A theme role (theme.colors.primary, .success, .warning). */
  readonly color: string;
};

export function BurstPiece({ index, elapsedMs, plan, color }: BurstPieceProps): ReactNode {
  const angle = (index / plan.pieces) * Math.PI * 2;
  const style = useAnimatedStyle(() => {
    const progress = pieceProgress(elapsedMs.get(), index, plan);
    const distance = TRAVEL * (1 - (1 - progress) ** 3);
    const isFlying = progress > 0 && progress < 1;
    return {
      opacity: isFlying ? 1 - progress * progress : 0,
      transform: [
        { translateX: Math.cos(angle) * distance },
        { translateY: Math.sin(angle) * distance },
        { scale: 1 - progress / 2 },
      ],
    };
  });
  return <Animated.View style={[styles.piece, { backgroundColor: color }, style]} />;
}
