// src/ui/animation/lottie-player.tsx
// Owned by the lottie-and-rive skill. One of the two files that import an animation runtime
// (rive-player.tsx is the other): lottie-react-native, for designer-exported one-shot or briefly
// looping illustrations. Rendered only by LottieMoment inside AnimationMoment, which decides play
// or still. Playing, it runs `plays` times and then reports done (never `loop`, which is endless);
// still, it shows `stillProgress` (0 to 1) and never starts: Lottie reads no reduce-motion setting
// of its own (lottie-react-native 7.3.8).
import LottieView from 'lottie-react-native';
import { useRef } from 'react';
import { StyleSheet } from 'react-native';

import type { Playback } from './animation-playback';
import type { AnimationObject } from 'lottie-react-native';
import type { ReactNode } from 'react';

export type LottiePlayerProps = {
  /** require('@/assets/animations/<file>.json'): a bundled file, never { uri }. */
  readonly source: AnimationObject;
  readonly playback: Playback;
  /** The frame shown while still, as progress from 0 (first frame) to 1 (last frame). */
  readonly stillProgress: number;
  /** How many times one playing run plays the file (1 for a one-shot). */
  readonly plays: number;
  readonly onPlaysDone: () => void;
  readonly onError: (error: unknown) => void;
};

const styles = StyleSheet.create({ fill: { flex: 1 } });

export function LottiePlayer(props: LottiePlayerProps): ReactNode {
  const { source, playback, stillProgress, plays, onPlaysDone, onError } = props;
  const viewRef = useRef<LottieView>(null);
  const playsLeft = useRef(plays);

  function handleFinish(isCancelled: boolean): void {
    if (isCancelled) return;
    playsLeft.current -= 1;
    if (playsLeft.current > 0) {
      viewRef.current?.play();
    } else {
      onPlaysDone();
    }
  }

  if (playback === 'still') {
    return (
      <LottieView
        key="still"
        source={source}
        progress={stillProgress}
        autoPlay={false}
        loop={false}
        style={styles.fill}
        onAnimationFailure={onError}
      />
    );
  }
  return (
    <LottieView
      key="play"
      ref={viewRef}
      source={source}
      autoPlay
      loop={false}
      style={styles.fill}
      onAnimationFinish={handleFinish}
      onAnimationFailure={onError}
    />
  );
}
