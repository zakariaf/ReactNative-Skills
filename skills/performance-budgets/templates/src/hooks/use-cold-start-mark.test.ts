// src/hooks/use-cold-start-mark.test.ts
// no-providers: the hook receives the perf port and the log as arguments and reads no context.
// One runtime per test file: the marks live in module state, so the cases walk one launch in order.
import { act, renderHook } from '@testing-library/react-native';

import { markJsEntry } from '@/services/perf/cold-start-marks';
import { createFakePerf } from '@/services/perf/fake-perf';
import { createFakePerfLog } from '@/services/perf-log/fake-perf-log';

import { useColdStartMark } from './use-cold-start-mark';

describe('useColdStartMark', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for the data, logs the launch once a frame after it is drawn, never without a log', async () => {
    const perf = createFakePerf({ epochMs: 10_200, processStartEpochMs: 10_000 });
    markJsEntry(10_100);
    await renderHook(() => {
      useColdStartMark({ perf, perfLog: null, label: 'tasks', isReady: true });
    });
    const log = createFakePerfLog();
    const view = await renderHook(
      ({ isReady }: { isReady: boolean }) => {
        useColdStartMark({ perf, perfLog: log, label: 'tasks', isReady });
      },
      { initialProps: { isReady: false } },
    );
    await act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(log.items()).toStrictEqual([]);
    perf.advance(700);
    await view.rerender({ isReady: true });
    expect(log.items()).toStrictEqual([]);
    await act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(log.items()).toStrictEqual([
      {
        kind: 'cold-start',
        label: 'tasks',
        atEpochMs: 10_900,
        build: '1',
        data: { nativeMs: 100, jsMs: 800, totalMs: 900, prewarmed: false },
      },
    ]);
    await renderHook(() => {
      useColdStartMark({ perf, perfLog: log, label: 'tasks', isReady: true });
    });
    await act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(log.items()).toHaveLength(1);
  });
});
