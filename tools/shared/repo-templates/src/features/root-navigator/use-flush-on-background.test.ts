// src/features/root-navigator/use-flush-on-background.test.ts
// no-providers: the hook takes its flushers and error log as arguments and reads no context.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { useFlushOnBackground } from './use-flush-on-background';

import type { AppStateStatus } from 'react-native';

/** The AppState 'change' listeners the hook registered (React Native's Jest AppState is inert). */
function watchAppState(initial: AppStateStatus): {
  readonly emit: (next: AppStateStatus) => void;
  readonly removed: jest.Mock;
} {
  Object.defineProperty(AppState, 'currentState', { value: initial, configurable: true });
  const removed = jest.fn();
  const listeners: ((next: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener);
    return { remove: removed };
  });
  return {
    emit: (next) => {
      listeners.forEach((listener) => {
        listener(next);
      });
    },
    removed,
  };
}

describe('useFlushOnBackground', () => {
  it('flushes once when iOS goes inactive then background, and again after coming back', async () => {
    const appState = watchAppState('active');
    const flush = jest.fn();
    const flushers = [{ name: 'draft', flush }];
    const errorLog = createFakeErrorLog();
    await renderHook(() => {
      useFlushOnBackground(flushers, errorLog);
    });
    await act(() => {
      appState.emit('inactive');
      appState.emit('background');
    });
    expect(flush).toHaveBeenCalledTimes(1);
    await act(() => {
      appState.emit('active');
      appState.emit('background');
    });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('flushes when Android goes straight to background', async () => {
    const appState = watchAppState('active');
    const flush = jest.fn();
    const flushers = [{ name: 'draft', flush }];
    const errorLog = createFakeErrorLog();
    await renderHook(() => {
      useFlushOnBackground(flushers, errorLog);
    });
    await act(() => {
      appState.emit('background');
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('stops listening when AppRoot unmounts', async () => {
    const appState = watchAppState('active');
    const flushers = [{ name: 'draft', flush: jest.fn() }];
    const errorLog = createFakeErrorLog();
    const { unmount } = await renderHook(() => {
      useFlushOnBackground(flushers, errorLog);
    });
    await unmount();
    expect(appState.removed).toHaveBeenCalledTimes(1);
  });
});
