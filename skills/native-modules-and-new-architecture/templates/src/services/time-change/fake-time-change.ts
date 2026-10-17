// src/services/time-change/fake-time-change.ts
import { err, ok } from '@/core/result';

import type {
  TimeChangeEvent,
  TimeChangeFailure,
  TimeChangePort,
} from '@/services/time-change/time-change-port';

export type FakeTimeChangeOptions = {
  /** The zone timeZoneId() answers; default "Europe/Berlin". */
  readonly timeZoneId?: string;
  /** What isAutomaticTimeEnabled() answers: a value, or a failure (iOS: unsupported). Default true. */
  readonly automaticTime?: boolean | TimeChangeFailure;
};

/** A TimeChangePort whose time moves only when a test says so, with a call log. */
export type FakeTimeChange = TimeChangePort & {
  /** Moves the zone (for a time-zone event) and tells every listener. */
  readonly emit: (event: TimeChangeEvent) => void;
  /** Listeners still subscribed: 0 after every screen and effect has cleaned up. */
  readonly listenerCount: () => number;
  /** Every port call in order: "timeZoneId", "isAutomaticTimeEnabled", "subscribe", "unsubscribe". */
  readonly calls: readonly string[];
};

export function createFakeTimeChange(options: FakeTimeChangeOptions = {}): FakeTimeChange {
  let timeZoneId = options.timeZoneId ?? 'Europe/Berlin';
  const automaticTime = options.automaticTime ?? true;
  const listeners = new Set<(event: TimeChangeEvent) => void>();
  const calls: string[] = [];
  return {
    timeZoneId: () => {
      calls.push('timeZoneId');
      return ok(timeZoneId);
    },
    isAutomaticTimeEnabled: () => {
      calls.push('isAutomaticTimeEnabled');
      return Promise.resolve(
        typeof automaticTime === 'boolean' ? ok(automaticTime) : err(automaticTime),
      );
    },
    subscribe: (listener) => {
      calls.push('subscribe');
      listeners.add(listener);
      return () => {
        calls.push('unsubscribe');
        listeners.delete(listener);
      };
    },
    emit: (event) => {
      timeZoneId = event.timeZoneId;
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
    calls,
  };
}
