// src/services/time-change/native-time-change-adapter.test.ts
import { createNativeTimeChangeAdapter } from '@/services/time-change/native-time-change-adapter';

import type {
  NativeTimeChangePayload,
  TimeChangeBinding,
} from '@/services/time-change/native-time-change-adapter';
import type { TimeChangeEvent } from '@/services/time-change/time-change-port';

type NativeStub = TimeChangeBinding & {
  readonly send: (payload: NativeTimeChangePayload) => void;
  readonly listenerCount: () => number;
};

type StubOptions = {
  readonly timeZoneId?: () => string;
  readonly automaticTime?: (() => Promise<boolean>) | 'absent';
};

/** A stand-in for the native object with the same members the Swift and Kotlin sides export. */
function createNativeStub(options: StubOptions = {}): NativeStub {
  const listeners = new Set<(payload: NativeTimeChangePayload) => void>();
  const automaticTime = options.automaticTime ?? (() => Promise.resolve(true));
  return {
    getTimeZoneId: options.timeZoneId ?? (() => 'Europe/Berlin'),
    ...(automaticTime === 'absent' ? {} : { isAutomaticTimeEnabledAsync: automaticTime }),
    addListener: (_eventName, listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
    send: (payload) => {
      for (const listener of listeners) listener(payload);
    },
    listenerCount: () => listeners.size,
  };
}

/** A native error as both platforms reject: an Error with a string code. */
function codedError(code: string): Error {
  return Object.assign(new Error('native failure'), { code });
}

describe('createNativeTimeChangeAdapter', () => {
  it('answers unavailable everywhere when the binary has no TimeChange module', async () => {
    const port = createNativeTimeChangeAdapter(null);
    expect(port.timeZoneId()).toStrictEqual({
      ok: false,
      error: { kind: 'time-change-unavailable' },
    });
    await expect(port.isAutomaticTimeEnabled()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'time-change-unavailable' },
    });
    const unsubscribe = port.subscribe(() => undefined);
    expect(unsubscribe).not.toThrow();
  });

  it('binds lazily and optionally: in Jest the default lookup finds no module and nothing throws', () => {
    expect(() => createNativeTimeChangeAdapter()).not.toThrow();
    expect(createNativeTimeChangeAdapter().timeZoneId()).toStrictEqual({
      ok: false,
      error: { kind: 'time-change-unavailable' },
    });
  });

  it('reads the time zone and maps a native throw to its code', () => {
    expect(createNativeTimeChangeAdapter(createNativeStub()).timeZoneId()).toStrictEqual({
      ok: true,
      value: 'Europe/Berlin',
    });
    const failing = createNativeStub({
      timeZoneId: () => {
        throw codedError('ERR_REACT_CONTEXT_LOST');
      },
    });
    expect(createNativeTimeChangeAdapter(failing).timeZoneId()).toStrictEqual({
      ok: false,
      error: { kind: 'time-change-read-failed', code: 'ERR_REACT_CONTEXT_LOST' },
    });
  });

  it('answers unsupported where the platform has no automatic-time member (iOS)', async () => {
    const port = createNativeTimeChangeAdapter(createNativeStub({ automaticTime: 'absent' }));
    await expect(port.isAutomaticTimeEnabled()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'time-change-unsupported' },
    });
  });

  it('reads automatic time and maps a rejection without a code to ERR_UNKNOWN', async () => {
    const enabled = createNativeTimeChangeAdapter(createNativeStub());
    await expect(enabled.isAutomaticTimeEnabled()).resolves.toStrictEqual({
      ok: true,
      value: true,
    });
    const rejecting = createNativeTimeChangeAdapter(
      createNativeStub({ automaticTime: () => Promise.reject(new Error('no code')) }),
    );
    await expect(rejecting.isAutomaticTimeEnabled()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'time-change-read-failed', code: 'ERR_UNKNOWN' },
    });
  });

  it('forwards known reasons, drops unknown ones and releases the native listener', () => {
    const native = createNativeStub();
    const seen: TimeChangeEvent[] = [];
    const unsubscribe = createNativeTimeChangeAdapter(native).subscribe((event) => {
      seen.push(event);
    });
    native.send({ reason: 'time-zone', timeZoneId: 'Asia/Tokyo' });
    native.send({ reason: 'leap-second', timeZoneId: 'Asia/Tokyo' });
    native.send({ reason: 'day-change', timeZoneId: 'Asia/Tokyo' });
    expect(seen).toStrictEqual([
      { reason: 'time-zone', timeZoneId: 'Asia/Tokyo' },
      { reason: 'day-change', timeZoneId: 'Asia/Tokyo' },
    ]);
    expect(native.listenerCount()).toBe(1);
    unsubscribe();
    expect(native.listenerCount()).toBe(0);
  });
});
