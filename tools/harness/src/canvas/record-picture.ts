// src/canvas/record-picture.ts
'worklet';

import { describeError } from './describe-error';
import { sceneElapsedMs } from './scene';
import { sampleTimeline } from './timeline/sample';

import type { CanvasLayout } from './canvas-layout';
import type {
  CanvasColors,
  CanvasHighlight,
  DrawFrame,
  PointerSample,
  DrawKit,
} from './canvas-types';
import type { Scene } from './scene';
import type { SkCanvas, SkPicture, SkPictureRecorder } from '@shopify/react-native-skia';

export type RecordInput<TView, TToken extends string> = {
  readonly scene: Scene<TView>;
  readonly now: number;
  readonly layout: CanvasLayout;
  readonly pointer: PointerSample;
  readonly highlight: CanvasHighlight;
  readonly colors: CanvasColors<TToken>;
  readonly kit: DrawKit;
  readonly draw: (canvas: SkCanvas, frame: DrawFrame<TView, TToken>) => void;
  /** Must itself be a worklet (it runs on the UI thread); it forwards with scheduleOnRN. */
  readonly onError: (message: string) => void;
};

/**
 * Records one frame into a Picture. Runs inside useDerivedValue on the UI thread. A draw()
 * exception must not crash the app: report it and return the (empty) picture.
 */
export function recordPicture<TView, TToken extends string>(
  recorder: SkPictureRecorder,
  input: RecordInput<TView, TToken>,
): SkPicture {
  const canvas = recorder.beginRecording({
    x: 0,
    y: 0,
    width: input.layout.width,
    height: input.layout.height,
  });
  try {
    const timeline = sampleTimeline(input.scene.tracks, sceneElapsedMs(input.scene, input.now));
    input.draw(canvas, {
      view: input.scene.view,
      fx: { ...timeline, pointer: input.pointer },
      highlight: input.highlight,
      colors: input.colors,
      layout: input.layout,
      kit: input.kit,
    });
  } catch (error) {
    input.onError(describeError(error));
  }
  return recorder.finishRecordingAsPicture();
}
