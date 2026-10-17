// src/hooks/use-reminder-sync.test.ts
// no-providers: the hook takes the sync as an argument and reads only AppState through useIsAppActive.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useReminderSync } from './use-reminder-sync';

import type { TFunction } from '@/i18n/create-t';
import type {
  ReminderSync,
  ReminderSyncRequest,
} from '@/services/local-notifications/reminder-sync';
import type { AppStateStatus } from 'react-native';

function fakeAppState(initial: AppStateStatus): (state: AppStateStatus) => void {
  let listener: () => void = () => undefined;
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

function fakeSync(): ReminderSync & {
  readonly runs: () => number;
  readonly requests: () => readonly (ReminderSyncRequest | undefined)[];
} {
  const requests: (ReminderSyncRequest | undefined)[] = [];
  return {
    sync: () => Promise.resolve({ kind: 'not-allowed', permission: 'denied', cancelled: 0 }),
    request: (request) => {
      requests.push(request);
    },
    enable: () => Promise.resolve('denied'),
    runs: () => requests.length,
    requests: () => requests,
  };
}

const english: TFunction = (key) => `en:${key}`;
const arabic: TFunction = (key) => `ar:${key}`;

describe('useReminderSync', () => {
  it('syncs on mount, on every return to the foreground and on a language change', async () => {
    const moveTo = fakeAppState('active');
    const sync = fakeSync();
    const { rerender } = await renderHook(
      ({ t }: { readonly t: TFunction }) => {
        useReminderSync(sync, t);
      },
      { initialProps: { t: english } },
    );
    expect(sync.runs()).toBe(1);

    await act(() => {
      moveTo('background');
    });
    await act(() => {
      moveTo('active');
    });
    expect(sync.runs()).toBe(2);

    await rerender({ t: arabic });
    expect(sync.runs()).toBe(3);
    expect(sync.requests().map((request) => request?.t)).toStrictEqual([english, english, arabic]);
  });

  it('does not sync while the app is in the background', async () => {
    fakeAppState('background');
    const sync = fakeSync();

    await renderHook(() => {
      useReminderSync(sync, english);
    });

    expect(sync.runs()).toBe(0);
  });
});
