// src/services/time-change/native-time-change-adapter.ts
// The only binding of the local Expo module modules/time-change (TimeChangeModule.swift and
// TimeChangeModule.kt). The binding is lazy and optional: it runs when the composition root calls
// the factory, never at import time, and a binary without the module (Jest, web, a build older than
// the module) yields a port that answers `time-change-unavailable` instead of crashing at startup.
import { requireOptionalNativeModule } from 'expo';

import { attempt, attemptAsync, err } from '@/core/result';

import type { Result } from '@/core/result';
import type {
  TimeChangeEvent,
  TimeChangeFailure,
  TimeChangePort,
  TimeChangeReason,
} from '@/services/time-change/time-change-port';

/** The payload both native sides send with onTimeChange. */
export type NativeTimeChangePayload = {
  readonly reason: string;
  readonly timeZoneId: string;
};

/**
 * The cross-language contract: every member the Swift and Kotlin definitions export, by the names
 * they use. A member only one platform has is optional here, and the adapter handles its absence.
 * Change a native member and this type in the same commit.
 */
export type TimeChangeBinding = {
  getTimeZoneId(): string;
  /** Android only. */
  isAutomaticTimeEnabledAsync?(): Promise<boolean>;
  addListener(
    eventName: 'onTimeChange',
    listener: (payload: NativeTimeChangePayload) => void,
  ): { remove(): void };
};

const REASONS: readonly string[] = [
  'time-zone',
  'clock-set',
  'day-change',
] satisfies readonly TimeChangeReason[];

const UNAVAILABLE: TimeChangeFailure = { kind: 'time-change-unavailable' };

function isReason(value: string): value is TimeChangeReason {
  return REASONS.includes(value);
}

/** The binding where the platform exports the automatic-time member (Android). */
type AutomaticTimeReader = Required<Pick<TimeChangeBinding, 'isAutomaticTimeEnabledAsync'>>;

function readsAutomaticTime(
  binding: TimeChangeBinding,
): binding is TimeChangeBinding & AutomaticTimeReader {
  return binding.isAutomaticTimeEnabledAsync !== undefined;
}

/** A native error carries a string `code` (CodedException on Android, Exception on iOS). */
function readFailed(thrown: unknown): TimeChangeFailure {
  const code =
    typeof thrown === 'object' &&
    thrown !== null &&
    'code' in thrown &&
    typeof thrown.code === 'string'
      ? thrown.code
      : 'ERR_UNKNOWN';
  return { kind: 'time-change-read-failed', code };
}

/** A payload with a reason this build does not know (a newer native side) is dropped. */
function toEvent(payload: NativeTimeChangePayload): TimeChangeEvent | null {
  return isReason(payload.reason)
    ? { reason: payload.reason, timeZoneId: payload.timeZoneId }
    : null;
}

/**
 * Creates the device TimeChangePort. The composition root calls it with no argument; tests pass a
 * stand-in for the native object, or null for a binary without the module.
 */
export function createNativeTimeChangeAdapter(
  native: TimeChangeBinding | null = requireOptionalNativeModule<TimeChangeBinding>('TimeChange'),
): TimeChangePort {
  return {
    timeZoneId: (): Result<string, TimeChangeFailure> =>
      native === null ? err(UNAVAILABLE) : attempt(() => native.getTimeZoneId(), readFailed),
    isAutomaticTimeEnabled: (): Promise<Result<boolean, TimeChangeFailure>> => {
      if (native === null) return Promise.resolve(err(UNAVAILABLE));
      if (!readsAutomaticTime(native))
        return Promise.resolve(err({ kind: 'time-change-unsupported' }));
      const reader: AutomaticTimeReader = native;
      return attemptAsync(() => reader.isAutomaticTimeEnabledAsync(), readFailed);
    },
    subscribe: (listener) => {
      if (native === null) return () => undefined;
      const subscription = native.addListener('onTimeChange', (payload) => {
        const event = toEvent(payload);
        if (event !== null) listener(event);
      });
      return () => {
        subscription.remove();
      };
    },
  };
}
