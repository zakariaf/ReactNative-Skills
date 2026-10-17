// src/services/perf/perf-port.ts
import type { PerfReportHeader } from '@/core/perf/perf-entry';
import type { Result } from '@/core/result';

/** Why sharing the report failed (the share sheet could not open); a dismissed sheet is not a failure. */
export type PerfShareFailure = { readonly kind: 'perf-share-failed' };

/**
 * Everything the measurement layer reads from the device: clocks, the process start time and the
 * build's identity, and the share sheet that is the only way a report leaves the phone. The adapter
 * (expo-perf-adapter.ts) is one of the two app files that read clocks for instrumentation (the lint
 * config's src/services/perf/*-adapter.ts exemption); fake-perf.ts stands in for it in tests.
 */
export type PerfPort = {
  /** Wall-clock epoch ms: entry timestamps and the cold-start marks. */
  readonly epochMs: () => number;
  /** A monotonic high-resolution clock in ms: durations (the storage benchmark). */
  readonly highResMs: () => number;
  /** Wall-clock start of this process from the native ProcessStart module, or null (Jest, web, failure). */
  readonly processStartEpochMs: () => number | null;
  /**
   * True when the process existed before the user's launch: iOS prewarming (ActivePrewarm=1), or on
   * Android 15+ a start for a push, broadcast, job, service or alarm. False when unknown (Jest, web).
   */
  readonly wasPrewarmed: () => boolean;
  /** App id, version, native build number, platform, OS version and device model. */
  readonly header: () => PerfReportHeader;
  /** Opens the system share sheet with the report; the app itself sends nothing anywhere. */
  readonly shareReport: (json: string) => Promise<Result<void, PerfShareFailure>>;
};
