// src/ui/animation/lottie-moment.tsx
// Owned by the lottie-and-rive skill. How a feature shows a Lottie file: a designer-exported
// one-shot or a short bounded loop. `source` is require('@/assets/animations/<file>.json') of a
// file recorded in contracts/animations.json; `plays`, `still` and `weight` repeat that record
// (check-animations compares them). An app without Lottie deletes this file, lottie-player.tsx,
// its test and the Lottie mock.
import { AnimationMoment } from './animation-moment';
import { LottiePlayer } from './lottie-player';

import type { MomentPlacement } from './animation-moment';
import type { AnimationObject } from 'lottie-react-native';
import type { ReactNode } from 'react';

export type LottieMomentProps = MomentPlacement & {
  readonly source: AnimationObject;
  /** Plays per run: 1 for a one-shot, at most budgets.maxPlays for a loop. Never endless. */
  readonly plays: number;
  /** Shown while still: progress from 0 (first frame) to 1 (last frame), or 'hidden'. */
  readonly still: number | 'hidden';
  readonly onFinish?: () => void;
  readonly onError: (error: unknown) => void;
};

export function LottieMoment(props: LottieMomentProps): ReactNode {
  const { source, plays, still, onFinish, onError, ...placement } = props;
  return (
    <AnimationMoment {...placement} isHiddenWhenStill={still === 'hidden'}>
      {({ playback, isDone, finish }) => (
        <LottiePlayer
          source={source}
          playback={playback}
          // After the last play the end frame stays; before it, the declared still frame.
          stillProgress={isDone || still === 'hidden' ? 1 : still}
          plays={plays}
          onPlaysDone={() => {
            finish();
            onFinish?.();
          }}
          onError={onError}
        />
      )}
    </AnimationMoment>
  );
}
