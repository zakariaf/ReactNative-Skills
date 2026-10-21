// src/ui/animation/rive-player.tsx
// Owned by the lottie-and-rive skill. One of the two files that import an animation runtime
// (lottie-player.tsx is the other): @rive-app/react-native, for interactive state machines.
// Rendered only by RiveMoment inside AnimationMoment, which decides play or still. Still means
// autoPlay off and pause(), so the state machine rests on its first frame (read from source in
// @rive-app/react-native 0.5.5: RiveView documents play() and pause(); it reads no reduce-motion
// setting of its own).
import { Fit, RiveView, useRive, useRiveFile } from '@rive-app/react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Playback } from './animation-playback';
import type { RiveFileSource } from '@rive-app/react-native';
import type { ReactNode } from 'react';

export type RivePlayerProps = {
  /** require('@/assets/animations/<file>.riv'): a bundled file, never a URL. */
  readonly source: RiveFileSource;
  readonly playback: Playback;
  readonly stateMachineName: string;
  /** Frames per second the render loop may draw (its budget in contracts/animations.json). */
  readonly frameRate: number;
  readonly onError: (error: unknown) => void;
};

const styles = StyleSheet.create({ fill: { flex: 1 } });

export function RivePlayer(props: RivePlayerProps): ReactNode {
  const { source, playback, stateMachineName, frameRate, onError } = props;
  const { riveFile, error } = useRiveFile(source);
  const { riveViewRef, setHybridRef } = useRive();

  useEffect(() => {
    if (error !== null) onError(error);
  }, [error, onError]);

  useEffect(() => {
    if (riveViewRef === null || riveViewRef === undefined) return;
    const step = playback === 'play' ? riveViewRef.play() : riveViewRef.pause();
    step.catch(onError);
  }, [riveViewRef, playback, onError]);

  // Loading, or failed (reported above): keep the box, draw nothing.
  if (riveFile === null || riveFile === undefined) return <View style={styles.fill} />;
  return (
    <RiveView
      file={riveFile}
      hybridRef={setHybridRef}
      autoPlay={playback === 'play'}
      stateMachineName={stateMachineName}
      fit={Fit.Contain}
      frameRate={frameRate}
      onError={onError}
      style={styles.fill}
    />
  );
}
