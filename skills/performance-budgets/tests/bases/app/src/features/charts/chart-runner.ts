// src/features/charts/chart-runner.ts
import { useFrameCallback } from 'react-native-reanimated';

import { sampleFrame } from '@/services/perf/frame-recorder';

import type { FrameRecorder } from '@/services/perf/frame-recorder';
import type { SharedValue } from 'react-native-reanimated';

/** A live chart's clock: starts inactive, runs only while the chart moves, and feeds the recorder. */
export function useChartRunner(progress: SharedValue<number>, recorder: FrameRecorder | null) {
  const callback = useFrameCallback((info) => {
    progress.set(progress.get() + (info.timeSincePreviousFrame ?? 0));
    if (recorder !== null) sampleFrame(recorder, info.timeSincePreviousFrame);
  }, false);
  return {
    start: () => {
      callback.setActive(true);
    },
    stop: () => {
      callback.setActive(false);
    },
  };
}
