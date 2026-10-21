// src/features/lists/components/list-completed-celebration.tsx (example: a shape to imitate)
// A heavy, decorative Lottie one-shot shown when the last open task of a list is checked off. The
// model hook owns the state: the handler that committed the check sets `celebratingListId`, so the
// moment starts from the commit, never from a mount or focus effect, and `isFocused` holds it still
// when the screen is left. The meaning ("List completed") is a heading and an announcement too, so
// nothing is lost when Reduce Motion shows the end frame or a screen reader skips the art.
import { StyleSheet } from 'react-native';

import { LottieMoment } from '@/ui/animation/lottie-moment';

import type { ReactNode } from 'react';

export type ListCompletedCelebrationProps = {
  /** True from the commit until onFinish; the model hook clears it. */
  readonly isCelebrating: boolean;
  /** useIsFocused() of the list screen, from the model hook. */
  readonly isFocused: boolean;
  readonly onFinish: () => void;
  /** errorLog.record from the services: a broken file is logged, never thrown into the UI. */
  readonly onError: (error: unknown) => void;
};

export function ListCompletedCelebration(props: ListCompletedCelebrationProps): ReactNode {
  if (!props.isCelebrating) return null;
  return (
    // contracts/animations.json: list-completed, lottie, one-shot, plays 1, heavy, decorative,
    // reducedMotion { show: frame, progress: 1 }. check-animations compares plays, weight and still.
    <LottieMoment
      source={require('@/assets/animations/list-completed.json')}
      plays={1}
      still={1}
      weight="heavy"
      decorative
      isActive={props.isFocused}
      style={StyleSheet.absoluteFill}
      testID="lists.completed-celebration"
      onFinish={props.onFinish}
      onError={props.onError}
    />
  );
}

// The list screen renders it above its rows, inside the app's one <AnimationStageProvider> (mounted
// with the root stack's providers), so a second heavy moment on the same screen waits for this one:
//
//   <AnimationStageProvider>
//     <Stack />
//   </AnimationStageProvider>
