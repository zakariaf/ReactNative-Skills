// src/services/perf/frame-recorder.test.ts
import { createFrameRecorder, sampleFrame, startRecording, stopRecording } from './frame-recorder';

describe('the frame recorder', () => {
  it('records only between start and stop', () => {
    const recorder = createFrameRecorder();
    sampleFrame(recorder, 8.3);
    startRecording(recorder);
    for (const dt of [null, 8.3, 8.4, 33]) sampleFrame(recorder, dt);
    const report = stopRecording(recorder);
    sampleFrame(recorder, 50);
    expect([report?.frames, report?.maxMs, report?.refreshHz]).toStrictEqual([3, 33, 120]);
    expect(recorder.histogram.get().frames).toBe(3);
  });

  it('starts every recording from an empty histogram', () => {
    const recorder = createFrameRecorder();
    startRecording(recorder);
    sampleFrame(recorder, 16.7);
    stopRecording(recorder);
    startRecording(recorder);
    expect(stopRecording(recorder)).toBeNull();
  });
});
