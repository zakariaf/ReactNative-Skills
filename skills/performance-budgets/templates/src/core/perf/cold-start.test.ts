// src/core/perf/cold-start.test.ts
import { STALE_PROCESS_START_MS, coldStartReport } from './cold-start';

describe('coldStartReport', () => {
  it('splits a launch into its native and JS parts', () => {
    const report = coldStartReport({
      processStartEpochMs: 10_000,
      jsEntryEpochMs: 10_500,
      firstScreenEpochMs: 10_900,
      isPrewarmed: false,
    });
    expect(report).toStrictEqual({ nativeMs: 500, jsMs: 400, totalMs: 900, prewarmed: false });
  });

  it('keeps the JS part when the process start is unknown', () => {
    const report = coldStartReport({
      processStartEpochMs: null,
      jsEntryEpochMs: 1_000,
      firstScreenEpochMs: 1_250,
      isPrewarmed: false,
    });
    expect(report).toStrictEqual({ nativeMs: null, jsMs: 250, totalMs: null, prewarmed: false });
  });

  it('flags a launch the OS reports as prewarmed, keeping its numbers for diagnosis', () => {
    const report = coldStartReport({
      processStartEpochMs: 10_000,
      jsEntryEpochMs: 10_500,
      firstScreenEpochMs: 10_900,
      isPrewarmed: true,
    });
    expect(report.prewarmed).toBe(true);
    expect(report.totalMs).toBe(900);
  });

  it('flags a process start too long before the JS entry to belong to this launch', () => {
    const atBound = coldStartReport({
      processStartEpochMs: 0,
      jsEntryEpochMs: STALE_PROCESS_START_MS,
      firstScreenEpochMs: STALE_PROCESS_START_MS + 300,
      isPrewarmed: false,
    });
    const overBound = coldStartReport({
      processStartEpochMs: 0,
      jsEntryEpochMs: STALE_PROCESS_START_MS + 1,
      firstScreenEpochMs: STALE_PROCESS_START_MS + 300,
      isPrewarmed: false,
    });
    expect([atBound.prewarmed, overBound.prewarmed]).toStrictEqual([false, true]);
  });
});
