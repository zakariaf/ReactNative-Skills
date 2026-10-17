// src/services/perf/frame-recorder.ts
// The frame-time recorder. It never owns a frame callback: the surface or loop that already runs
// one calls sampleFrame from it (skia-canvas-rendering's useSurfacePlayer({ onFrameTime }), a
// realtime loop's runner), so an idle screen stays idle and the recorder measures real frames.
import { makeMutable } from 'react-native-reanimated';

import { createFrameHistogram, recordFrame } from '@/core/perf/frame-histogram';
import { summarizeFrames } from '@/core/perf/frame-report';

import type { FrameHistogram } from '@/core/perf/frame-histogram';
import type { FrameReport } from '@/core/perf/frame-report';
import type { SharedValue } from 'react-native-reanimated';

export type FrameRecorder = {
  readonly histogram: SharedValue<FrameHistogram>;
  readonly isRecording: SharedValue<boolean>;
};

/** Made once (debug actions, a test build); the switch and every frame runner share the same values. */
export function createFrameRecorder(): FrameRecorder {
  return { histogram: makeMutable(createFrameHistogram()), isRecording: makeMutable(false) };
}

export function startRecording(recorder: FrameRecorder): void {
  recorder.histogram.set(createFrameHistogram());
  recorder.isRecording.set(true);
}

/** Stops and summarizes (null when no frame ran while recording). */
export function stopRecording(recorder: FrameRecorder): FrameReport | null {
  recorder.isRecording.set(false);
  return summarizeFrames(recorder.histogram.get());
}

/** Worklet: call from an existing frame callback with info.timeSincePreviousFrame. */
export function sampleFrame(recorder: FrameRecorder, dtMs: number | null): void {
  'worklet';
  if (!recorder.isRecording.get() || dtMs === null) return;
  recorder.histogram.set(recordFrame(recorder.histogram.get(), dtMs));
}
