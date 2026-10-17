// src/hooks/use-push-sync.test.ts
// no-providers: usePushSync takes its ports as arguments and reads only AppState.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { flushMicrotasks } from '@test/flush-microtasks';

import { usePushSync } from './use-push-sync';

import type { NamedPushChannel } from '@/services/push/push-port';
import type { AppStateStatus } from 'react-native';

const CHANNELS: readonly NamedPushChannel[] = [
  { id: 'general', name: 'General', description: 'News', importance: 'default' },
];

function fakeAppState(initial: AppStateStatus): (state: AppStateStatus) => void {
  let listener = (): void => undefined;
  const setCurrent = (state: AppStateStatus): void => {
    Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
  };
  setCurrent(initial);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type: string, next: () => void) => {
    listener = next;
    return { remove: () => undefined };
  });
  return (state) => {
    setCurrent(state);
    listener();
  };
}

function setup(isFailing = false) {
  const synced: (string | null)[] = [];
  const named: (readonly NamedPushChannel[])[] = [];
  const errorLog = createFakeErrorLog();
  const push = {
    syncChannels: (channels: readonly NamedPushChannel[]) => {
      named.push(channels);
      return isFailing ? Promise.reject(new Error('channels failed')) : Promise.resolve();
    },
  };
  const registration = {
    sync: (accountId: string | null) => {
      synced.push(accountId);
      return isFailing
        ? Promise.reject(new Error('sync failed'))
        : Promise.resolve('none' as const);
    },
  };
  return { synced, named, errorLog, push, registration };
}

describe('usePushSync', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('syncs at launch, on each return to the foreground and for a new account', async () => {
    const moveTo = fakeAppState('active');
    const { synced, named, errorLog, push, registration } = setup();
    const { rerender } = await renderHook(
      ({ accountId }: { accountId: string | null }) => {
        usePushSync({ push, registration, errorLog, channels: CHANNELS, accountId });
      },
      { initialProps: { accountId: 'acc-1' } },
    );
    await act(() => {
      moveTo('background');
    });
    await act(() => {
      moveTo('active');
    });
    await rerender({ accountId: null });
    await act(flushMicrotasks);

    expect(synced).toStrictEqual(['acc-1', 'acc-1', null]);
    expect(named).toStrictEqual([CHANNELS]);
  });

  it('records failures instead of losing them', async () => {
    fakeAppState('active');
    const { errorLog, push, registration } = setup(true);
    await renderHook(() => {
      usePushSync({ push, registration, errorLog, channels: CHANNELS, accountId: 'acc-1' });
    });
    await act(flushMicrotasks);
    expect(
      errorLog
        .entries()
        .map((entry) => entry.message)
        .sort(),
    ).toStrictEqual(['channels failed', 'sync failed']);
  });

  it('syncs the registration only after the channels exist (no token before a channel)', async () => {
    fakeAppState('active');
    const order: string[] = [];
    let finishChannels = (): void => undefined;
    const errorLog = createFakeErrorLog();
    const push = {
      syncChannels: () =>
        new Promise<void>((resolve) => {
          order.push('channels started');
          finishChannels = () => {
            order.push('channels done');
            resolve();
          };
        }),
    };
    const registration = {
      sync: () => {
        order.push('sync');
        return Promise.resolve('none' as const);
      },
    };
    await renderHook(() => {
      usePushSync({ push, registration, errorLog, channels: CHANNELS, accountId: 'acc-1' });
    });
    await act(flushMicrotasks);
    expect(order).toStrictEqual(['channels started']);
    await act(async () => {
      finishChannels();
      await flushMicrotasks();
    });
    expect(order).toStrictEqual(['channels started', 'channels done', 'sync']);
  });
});
