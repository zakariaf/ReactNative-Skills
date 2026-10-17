// src/hooks/use-cold-start-mark.ts
import { useEffect } from 'react';

import { takeColdStartReport } from '@/services/perf/cold-start-marks';

import type { PerfPort } from '@/services/perf/perf-port';
import type { PerfLogPort } from '@/services/perf-log/perf-log-port';

export type ColdStartMarkInput = {
  readonly perf: PerfPort;
  /** The test-only perf log, or null (store builds): then nothing is logged. */
  readonly perfLog: PerfLogPort | null;
  /** The first screen's name, e.g. 'tasks'. */
  readonly label: string;
  /** True once the screen shows its real data, not a spinner or a skeleton. */
  readonly isReady: boolean;
};

/**
 * The first screen's model hook calls this on every render; `isReady` is true once the screen shows
 * its real data (for a query, `query.isSuccess`; for data loaded before the screen, `true`). A
 * spinner or skeleton is not the first screen: the mark waits for `isReady`, then lands one frame
 * after that commit, when the data is drawn, once per runtime. It measures and never sets state.
 * `perfLog` is null in store builds (the test-only entry is absent), so nothing is logged.
 */
export function useColdStartMark(input: ColdStartMarkInput): void {
  const { perf, perfLog, label, isReady } = input;
  useEffect(() => {
    if (perfLog === null || !isReady) return undefined;
    const frame = requestAnimationFrame(() => {
      const atEpochMs = perf.epochMs();
      const report = takeColdStartReport({
        nowEpochMs: atEpochMs,
        processStartEpochMs: perf.processStartEpochMs(),
        isPrewarmed: perf.wasPrewarmed(),
      });
      if (report === null) return;
      const build = perf.header().buildNumber;
      perfLog.append({ kind: 'cold-start', label, atEpochMs, build, data: report });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [perf, perfLog, label, isReady]);
}
