// src/hooks/use-pause-on-background.test.tsx
// no-providers: usePauseOnBackground reads only the app state and the screen focus (both mocked).
import { renderHook } from '@testing-library/react-native';

import { shouldPauseRun, usePauseOnBackground } from './use-pause-on-background';

import type { SessionStatus } from '@/stores/game-session/game-session-types';

const mockScreen = { isActive: true, isFocused: true };
jest.mock('@/hooks/use-is-app-active', () => ({
  useIsAppActive: () => mockScreen.isActive,
}));
jest.mock('expo-router', () => ({
  useIsFocused: () => mockScreen.isFocused,
}));

describe('shouldPauseRun', () => {
  it('pauses a playing run only on the change to away', () => {
    expect(shouldPauseRun({ status: 'playing', wasAway: false, isAway: true })).toBe(true);
    expect(shouldPauseRun({ status: 'playing', wasAway: true, isAway: true })).toBe(false);
    expect(shouldPauseRun({ status: 'paused', wasAway: false, isAway: true })).toBe(false);
    expect(shouldPauseRun({ status: null, wasAway: false, isAway: true })).toBe(false);
  });
});

describe('usePauseOnBackground', () => {
  beforeEach(() => {
    mockScreen.isActive = true;
    mockScreen.isFocused = true;
  });

  async function setup(status: SessionStatus) {
    const pause = jest.fn();
    const view = await renderHook(
      ({ current }: { readonly current: SessionStatus }) => {
        usePauseOnBackground(current, pause);
      },
      { initialProps: { current: status } },
    );
    return { pause, rerender: view.rerender };
  }

  it('pauses when the app goes to the background (iOS and Android) or the screen loses focus', async () => {
    const { pause, rerender } = await setup('playing');

    expect(pause).not.toHaveBeenCalled();

    mockScreen.isActive = false;
    await rerender({ current: 'playing' });

    expect(pause).toHaveBeenCalledTimes(1);

    mockScreen.isActive = true;
    await rerender({ current: 'paused' });
    mockScreen.isFocused = false;
    await rerender({ current: 'playing' });

    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('leaves a run alone in the state it opened in', async () => {
    mockScreen.isActive = false;
    const { pause } = await setup('playing');

    expect(pause).not.toHaveBeenCalled();
  });
});
