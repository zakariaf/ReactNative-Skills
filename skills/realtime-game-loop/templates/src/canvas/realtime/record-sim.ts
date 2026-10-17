// src/canvas/realtime/record-sim.ts
'worklet';

import { describeError } from '@/canvas/describe-error';

import type { CanvasColors, DrawKit } from '@/canvas/canvas-types';
import type { SkCanvas, SkPicture, SkPictureRecorder } from '@shopify/react-native-skia';

/** The inputs of a real-time draw(): the LIVE sim (typed arrays), the canvas size, colours and kit. */
export type SimFrame<TSim, TToken extends string> = {
  readonly sim: TSim;
  readonly width: number;
  readonly height: number;
  readonly colors: CanvasColors<TToken>;
  readonly kit: DrawKit;
};

/** A real-time surface's draw(): a pure worklet that reads the sim in place. */
export type SimDraw<TSim, TToken extends string> = (
  canvas: SkCanvas,
  frame: SimFrame<TSim, TToken>,
) => void;

export type RecordSimInput<TSim, TToken extends string> = SimFrame<TSim, TToken> & {
  readonly draw: SimDraw<TSim, TToken>;
  /** Must itself be a worklet (it runs on the UI thread); it forwards with scheduleOnRN. */
  readonly onError: (message: string) => void;
};

/**
 * Records one frame of a real-time surface into a Picture, inside useDerivedValue on the UI thread.
 * The sim is read in place (no copy); a draw() exception is reported, never thrown.
 */
export function recordSim<TSim, TToken extends string>(
  recorder: SkPictureRecorder,
  input: RecordSimInput<TSim, TToken>,
): SkPicture {
  const canvas = recorder.beginRecording({ x: 0, y: 0, width: input.width, height: input.height });
  try {
    input.draw(canvas, input);
  } catch (error) {
    input.onError(describeError(error));
  }
  return recorder.finishRecordingAsPicture();
}
