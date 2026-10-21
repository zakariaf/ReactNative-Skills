// src/ui/animation/animation-moment.tsx
// Owned by the lottie-and-rive skill. The frame every Lottie or Rive moment renders through
// (LottieMoment, RiveMoment). It reads reduce motion from useReduceMotion(): the phone's switch,
// the in-app setting, and a test build held still (the debug kit's motion=still arrives there as
// preference 'on', so test mode is the same one path, never a second switch). It holds the still
// frame off screen and in the background, ends a bounded run (`finish`), lets one heavy moment play
// at a time (AnimationStageProvider), and hides decorative art from VoiceOver and TalkBack.
import { useState } from 'react';
import { View } from 'react-native';

import { useIsAppActive } from '@/hooks/use-is-app-active';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { playbackOf } from './animation-playback';
import { useAnimationSlot } from './animation-stage';

import type { AnimationWeight, Playback } from './animation-playback';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** Decorative art says nothing to a screen reader; informative art is one image with a t() label. */
export type MomentMeaning =
  { readonly decorative: true } | { readonly decorative: false; readonly label: string };

/** What every moment is given by the feature that shows it (from its model hook). */
export type MomentPlacement = MomentMeaning & {
  /** The record's "heavy" in contracts/animations.json: a heavy moment waits for another heavy one. */
  readonly weight: AnimationWeight;
  /** The screen is focused and the moment is on screen. */
  readonly isActive: boolean;
  readonly style: StyleProp<ViewStyle>;
  readonly testID: string;
};

export type MomentState = {
  readonly playback: Playback;
  /** True once a bounded run has used every play. */
  readonly isDone: boolean;
  readonly finish: () => void;
};

export type AnimationMomentProps = MomentPlacement & {
  /** The reduced alternative is "hidden": draw nothing (keeping the box) while still. */
  readonly isHiddenWhenStill: boolean;
  readonly children: (state: MomentState) => ReactNode;
};

const HIDDEN_FROM_READERS = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

export function AnimationMoment(props: AnimationMomentProps): ReactNode {
  const isReduceMotion = useReduceMotion();
  const isAppActive = useIsAppActive();
  const [isDone, setIsDone] = useState(false);
  const shouldPlay = !isReduceMotion && props.isActive && isAppActive && !isDone;
  const hasSlot = useAnimationSlot(props.weight, shouldPlay);
  const playback = playbackOf({
    isReduceMotion,
    isActive: props.isActive,
    isAppActive,
    hasSlot,
    isDone,
  });
  const readers = props.decorative
    ? HIDDEN_FROM_READERS
    : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: props.label };
  const isHidden = playback === 'still' && props.isHiddenWhenStill;

  function finish(): void {
    setIsDone(true);
  }

  return (
    <View style={props.style} testID={props.testID} {...readers}>
      {isHidden ? null : props.children({ playback, isDone, finish })}
    </View>
  );
}
