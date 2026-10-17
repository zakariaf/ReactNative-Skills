// src/services/perf/cold-start-marks.test.ts
// One runtime per test file: the marks live in module state, so this file walks one launch in order.
import { markJsEntry, takeColdStartReport } from './cold-start-marks';

describe('the cold-start marks of one runtime', () => {
  it('reports nothing before the JS entry mark, then one launch, then nothing again', () => {
    const reading = { processStartEpochMs: 10_000, isPrewarmed: false };
    expect(takeColdStartReport({ ...reading, nowEpochMs: 10_000 })).toBeNull();
    markJsEntry(10_500);
    markJsEntry(10_700);
    expect(takeColdStartReport({ ...reading, nowEpochMs: 10_900 })).toStrictEqual({
      nativeMs: 500,
      jsMs: 400,
      totalMs: 900,
      prewarmed: false,
    });
    expect(takeColdStartReport({ ...reading, nowEpochMs: 20_000 })).toBeNull();
  });
});
