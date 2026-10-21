// src/ui/animation/rive-moment.tsx
// Owned by the lottie-and-rive skill. How a feature shows a Rive file: an interactive state
// machine. `source` is require('@/assets/animations/<file>.riv') of a file recorded in
// contracts/animations.json; `frameRate`, `still` and `weight` repeat that record
// (check-animations compares them). An app without Rive deletes this file, rive-player.tsx, its
// test and the Rive mock.
import { AnimationMoment } from './animation-moment';
import { RivePlayer } from './rive-player';

import type { MomentPlacement } from './animation-moment';
import type { RiveFileSource } from '@rive-app/react-native';
import type { ReactNode } from 'react';

export type RiveMomentProps = MomentPlacement & {
  readonly source: RiveFileSource;
  readonly stateMachineName: string;
  /** The record's fps: the most frames per second the render loop draws. */
  readonly frameRate: number;
  /** Shown while still: the state machine paused on its first frame, or 'hidden'. */
  readonly still: 'first-frame' | 'hidden';
  readonly onError: (error: unknown) => void;
};

export function RiveMoment(props: RiveMomentProps): ReactNode {
  const { source, stateMachineName, frameRate, still, onError, ...placement } = props;
  return (
    <AnimationMoment {...placement} isHiddenWhenStill={still === 'hidden'}>
      {({ playback }) => (
        <RivePlayer
          source={source}
          playback={playback}
          stateMachineName={stateMachineName}
          frameRate={frameRate}
          onError={onError}
        />
      )}
    </AnimationMoment>
  );
}
