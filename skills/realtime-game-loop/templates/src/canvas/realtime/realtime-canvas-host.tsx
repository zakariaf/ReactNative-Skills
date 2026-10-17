// src/canvas/realtime/realtime-canvas-host.tsx
// The surface of a real-time game: the fixed-step loop, the live picture, the stick input and the
// lifecycle, around ONE Skia canvas. Turn-based surfaces use the canvas kit's SurfaceHost instead.
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useCanvasLifecycle } from '@/canvas/use-canvas-lifecycle';

import { recordSim } from './record-sim';
import { useFixedStepLoop } from './use-fixed-step-loop';

import type { SimDraw } from './record-sim';
import type { CanvasColors, DrawKit } from '@/canvas/canvas-types';
import type { FixedStepSim } from '@/core/realtime/realtime-spec';
import type { SkSize } from '@shopify/react-native-skia';
import type { ComposedGesture, GestureType } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';

export type RealtimeCanvasHostProps<TSim, TToken extends string> = {
  /** Created once by the game screen (realtime.createSim(state)) from a fresh or saved run. */
  readonly initialSim: TSim;
  readonly game: FixedStepSim<TSim>;
  /** Worklet: paints the live sim. Allocates no Skia objects and reads no clock. */
  readonly draw: SimDraw<TSim, TToken>;
  readonly colors: CanvasColors<TToken>;
  readonly kit: DrawKit;
  /** Builds the input gesture that writes the integer command (the canvas kit's makeStickGesture). */
  readonly makeGesture: (command: SharedValue<number>) => ComposedGesture | GestureType;
  /** Already translated with t(). */
  readonly accessibilityLabel: string;
  /** useIsFocused() of the game screen. */
  readonly isFocused: boolean;
  /** Something full-screen covers the surface (an interstitial, a video, a sheet over the screen). */
  readonly isInterrupted: boolean;
  /** The game screen's pause state. The loop runs only while this is false. */
  readonly isPaused: boolean;
  /** The run is over (a run-end event arrived): the loop stops with no save point and no pause. */
  readonly isEnded: boolean;
  /** JS: batched sim events [kind, value, tick, …], at most once per frame. */
  readonly onEvents: (events: readonly number[]) => void;
  /** JS: true when a batch holds a save-point event (a wave end): the spec's isSavePoint. */
  readonly isSavePoint: (events: readonly number[]) => boolean;
  /** JS: a copy of the sim at a save point (wave end, pause, background, blur). Save it with the input log. */
  readonly onSavePoint: (sim: TSim) => void;
  /** JS: the loop stopped for a lifecycle reason; show the pause UI (real-time games never auto-resume). */
  readonly onAutoPause: () => void;
  /** Pause the game and write the error log. */
  readonly onFailure: (message: string) => void;
  /** Debug and measurement builds: a frame-time recorder worklet (performance-budgets); omit in store builds. */
  readonly onFrameTime?: ((dtMs: number | null) => void) | null;
};

export function RealtimeCanvasHost<TSim, TToken extends string>(
  props: RealtimeCanvasHostProps<TSim, TToken>,
): React.JSX.Element {
  const { colors, kit, draw, onFailure } = props;
  const sim = useSharedValue(props.initialSim);
  const command = useSharedValue(0);
  const size = useSharedValue<SkSize>({ width: 0, height: 0 });
  const [recorder] = useState(() => Skia.PictureRecorder());
  const handleEvents = (events: readonly number[]): void => {
    // sim.get() on JS is a synchronous copy taken between two frames, so it is consistent.
    if (props.isSavePoint(events)) props.onSavePoint(sim.get());
    props.onEvents(events);
  };
  const loop = useFixedStepLoop({
    sim,
    command,
    game: props.game,
    onEvents: handleEvents,
    onError: onFailure,
    onFrameTime: props.onFrameTime ?? null,
  });
  useCanvasLifecycle({
    isFocused: props.isFocused,
    // The pause UI and the result cover the surface too: the loop never resumes by itself.
    isInterrupted: props.isInterrupted || props.isPaused || props.isEnded,
    onPause: () => {
      loop.stop();
      // The game screen records a finished run itself (outcome, statistics) and shows the result.
      if (props.isEnded) return;
      props.onSavePoint(sim.get());
      props.onAutoPause();
    },
    onResume: () => {
      loop.start();
    },
  });
  const reportDrawError = (message: string): void => {
    'worklet';
    scheduleOnRN(onFailure, message);
  };
  const picture = useDerivedValue(() => {
    const { width, height } = size.get();
    return recordSim(recorder, {
      sim: sim.get(),
      width,
      height,
      colors,
      kit,
      draw,
      onError: reportDrawError,
    });
  });
  return (
    <GestureDetector gesture={props.makeGesture(command)}>
      <Canvas
        style={styles.canvas}
        onSize={size}
        opaque
        accessible
        accessibilityRole="image"
        accessibilityLabel={props.accessibilityLabel}
      >
        <Picture picture={picture} />
      </Canvas>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
