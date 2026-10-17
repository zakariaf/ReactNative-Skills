// src/data/use-checkpoint-on-background.test.ts: the WAL checkpoint runs on background, never before, and stops on unmount.
// no-providers: the hook takes its database as an argument and reads no context, so renderHook needs no wrapper.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useCheckpointOnBackground } from './use-checkpoint-on-background';

import type { AppStateStatus } from 'react-native';

/** The AppState 'change' listeners the hook registered (React Native's Jest AppState is inert). */
function watchAppState(): {
  readonly emit: (next: AppStateStatus) => void;
  readonly removed: jest.Mock;
} {
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

describe('useCheckpointOnBackground', () => {
  it('checkpoints when the app goes to the background, not when it is only inactive', async () => {
    const appState = watchAppState();
    const database = { checkpoint: jest.fn() };
    await renderHook(() => {
      useCheckpointOnBackground(database);
    });
    await act(() => {
      appState.emit('inactive');
    });
    expect(database.checkpoint).not.toHaveBeenCalled();
    await act(() => {
      appState.emit('background');
    });
    expect(database.checkpoint).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the root layout unmounts', async () => {
    const appState = watchAppState();
    const { unmount } = await renderHook(() => {
      useCheckpointOnBackground({ checkpoint: jest.fn() });
    });
    await unmount();
    expect(appState.removed).toHaveBeenCalledTimes(1);
  });
});
