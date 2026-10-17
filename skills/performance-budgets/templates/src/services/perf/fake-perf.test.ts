// src/services/perf/fake-perf.test.ts
import { FAKE_PERF_HEADER, createFakePerf } from './fake-perf';

describe('createFakePerf', () => {
  it('moves both clocks only when told to', () => {
    const perf = createFakePerf({ epochMs: 1_000, highResStepMs: 0.5 });
    expect([perf.epochMs(), perf.highResMs(), perf.highResMs()]).toStrictEqual([1_000, 0.5, 1]);
    perf.advance(100);
    expect([perf.epochMs(), perf.highResMs()]).toStrictEqual([1_100, 101.5]);
  });

  it('answers the process start and the prewarm flag it was given, or null and false', () => {
    const given = createFakePerf({ processStartEpochMs: 400, isPrewarmed: true });
    expect([given.processStartEpochMs(), given.wasPrewarmed()]).toStrictEqual([400, true]);
    const unknown = createFakePerf();
    expect([unknown.processStartEpochMs(), unknown.wasPrewarmed()]).toStrictEqual([null, false]);
  });

  it('records what it shares, or fails like a share sheet that cannot open', async () => {
    const perf = createFakePerf();
    await expect(perf.shareReport('{}')).resolves.toStrictEqual({ ok: true, value: undefined });
    expect([perf.shared, perf.header()]).toStrictEqual([['{}'], FAKE_PERF_HEADER]);
    const failing = createFakePerf({ isShareFailing: true });
    await expect(failing.shareReport('{}')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'perf-share-failed' },
    });
  });
});
