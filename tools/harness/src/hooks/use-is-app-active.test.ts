// src/hooks/use-is-app-active.test.ts
// no-providers: useIsAppActive reads only React Native's AppState module, never a provider.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useIsAppActive } from './use-is-app-active';

import type { useSyncExternalStore } from 'react';
import type { AppStateStatus } from 'react-native';

type Listener = () => void;

/** The part of React's module object the hook calls. */
type ReactStoreModule = { useSyncExternalStore: typeof useSyncExternalStore };

/** A fake OS: sets AppState.currentState, captures the hook's listener, counts removals. */
function fakeAppState(initial: AppStateStatus): {
  readonly moveTo: (state: AppStateStatus) => void;
  readonly removed: number[];
} {
  let listener: Listener = () => undefined;
  const removed: number[] = [];
  const setCurrent = (state: AppStateStatus): void => {
    Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
  };
  setCurrent(initial);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type: string, next: Listener) => {
    listener = next;
    return { remove: () => removed.push(1) };
  });
  return {
    // React Native updates currentState before it calls the app's listeners.
    moveTo: (state) => {
      setCurrent(state);
      listener();
    },
    removed,
  };
}

describe('useIsAppActive', () => {
  it('is true in the foreground and follows background and inactive changes', async () => {
    const app = fakeAppState('active');
    const { result } = await renderHook(() => useIsAppActive());
    expect(result.current).toBe(true);

    await act(() => {
      app.moveTo('background');
    });
    expect(result.current).toBe(false);

    await act(() => {
      app.moveTo('inactive');
    });
    expect(result.current).toBe(false);

    await act(() => {
      app.moveTo('active');
    });
    expect(result.current).toBe(true);
  });

  it('starts false when the app launches in the background, and unsubscribes on unmount', async () => {
    const app = fakeAppState('background');
    const { result, unmount } = await renderHook(() => useIsAppActive());
    expect(result.current).toBe(false);

    await unmount();
    expect(app.removed).toStrictEqual([1]);
  });

  it('gives React a server snapshot that reports active, for static web rendering', async () => {
    fakeAppState('background');
    // The module object the hook imports from (no React mock is active), so the spy sees its call.
    const react = jest.requireActual<ReactStoreModule>('react');
    const store = jest.spyOn(react, 'useSyncExternalStore');
    await renderHook(() => useIsAppActive());
    const getServerSnapshot = store.mock.calls[0]?.[2];
    expect(getServerSnapshot?.()).toBe(true);
  });
});
