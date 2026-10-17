// src/ui/motion/celebration-burst.tsx
// A bounded burst of decorative pieces from the point of action: render it inside the control that
// was pressed (a task's checkbox) and it fills that box and bursts from its centre. It never takes a
// touch (pointerEvents 'none'), screen readers never reach it (the result itself is on screen and
// announced), it moves at most CELEBRATION_LIMITS.maxPieces pieces, and under reduced motion it draws
// nothing: a burst's reduced alternative is always 'none'.
import { StyleSheet, View } from 'react-native';

import { BurstPiece } from './burst-piece';
import { CELEBRATION_LIMITS } from './motion-moments';

import type { Celebration } from './use-celebration';
import type { ReactNode } from 'react';

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});

export type CelebrationBurstProps = {
  /** From useCelebration(MOTION_MOMENTS.<celebration>) in the component that owns the result. */
  readonly celebration: Celebration;
  /** Theme roles the pieces cycle through. */
  readonly colors: readonly string[];
  readonly testID: string;
};

/** How many pieces a plan may draw: never more than the celebration limit. */
export function pieceCountOf(pieces: number): number {
  return Math.min(Math.max(Math.trunc(pieces), 0), CELEBRATION_LIMITS.maxPieces);
}

export function CelebrationBurst({
  celebration,
  colors,
  testID,
}: CelebrationBurstProps): ReactNode {
  if (celebration.isReduced || colors.length === 0) return null;
  const { elapsedMs, plan } = celebration;
  const pieces = Array.from({ length: pieceCountOf(plan.pieces) }, (_, index) => ({
    id: `piece-${String(index)}`,
    index,
  }));
  return (
    <View
      testID={testID}
      style={styles.layer}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {pieces.map((piece) => (
        <BurstPiece
          key={piece.id}
          index={piece.index}
          elapsedMs={elapsedMs}
          plan={plan}
          color={colors[piece.index % colors.length] ?? ''}
        />
      ))}
    </View>
  );
}
