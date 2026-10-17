// src/services/time-change/time-change-port.ts
// The app's one answer to "did the device's time just move?": a time zone change, a clock set by hand
// or by the network, or a new calendar day. Device adapter: native-time-change-adapter.ts over the
// local Expo module in modules/time-change; fake: fake-time-change.ts.
import type { Result } from '@/core/result';

/** Why the device's time moved. The iOS and Android sides send exactly these three strings. */
export type TimeChangeReason = 'time-zone' | 'clock-set' | 'day-change';

/** One change, as the OS reported it. */
export type TimeChangeEvent = {
  readonly reason: TimeChangeReason;
  /** The IANA time zone id after the change, for example "Europe/Berlin". */
  readonly timeZoneId: string;
};

/**
 * Why a read failed. `time-change-unavailable`: the running binary has no TimeChange module (Jest,
 * web, or a build made before the module existed). `time-change-unsupported`: this platform has no
 * such setting (iOS for automatic time). `time-change-read-failed`: the native call threw; `code` is
 * its error code (for example ERR_REACT_CONTEXT_LOST).
 */
export type TimeChangeFailure =
  | { readonly kind: 'time-change-unavailable' }
  | { readonly kind: 'time-change-unsupported' }
  | { readonly kind: 'time-change-read-failed'; readonly code: string };

/** What the app asks of the device about time changes. */
export type TimeChangePort = {
  /** The IANA time zone id now. */
  readonly timeZoneId: () => Result<string, TimeChangeFailure>;
  /** Whether "Set time automatically" is on (Android); iOS answers `time-change-unsupported`. */
  readonly isAutomaticTimeEnabled: () => Promise<Result<boolean, TimeChangeFailure>>;
  /**
   * Calls `listener` on every change until the returned function is called. The OS can report one
   * move twice (a time zone change is also a significant time change on iOS): listeners re-read.
   */
  readonly subscribe: (listener: (event: TimeChangeEvent) => void) => () => void;
};
