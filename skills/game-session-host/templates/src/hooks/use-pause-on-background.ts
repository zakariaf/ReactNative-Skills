// src/hooks/use-pause-on-background.ts
import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useRef } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';

import type { SessionStatus } from '@/stores/game-session/game-session-types';

export type PauseInput = {
  readonly status: SessionStatus | null;
  /** The app was in the foreground with the Game screen focused before this change. */
  readonly wasAway: boolean;
  readonly isAway: boolean;
};

/**
 * A playing run pauses at the moment the app leaves the foreground (iOS 'inactive' or
 * 'background', Android 'background') or the Game screen loses focus (a modal, another route).
 * Only the change counts, so a run is never paused by the state it opened in.
 */
export function shouldPauseRun(input: PauseInput): boolean {
  return input.status === 'playing' && input.isAway && !input.wasAway;
}

/**
 * Mounted once by the Game screen's model hook. Pausing writes the run with its play time, and
 * coming back shows the Pause menu, never a running game.
 */
export function usePauseOnBackground(status: SessionStatus | null, pause: () => void): void {
  const isAppActive = useIsAppActive();
  const isFocused = useIsFocused();
  const isAway = !(isAppActive && isFocused);
  const wasAwayRef = useRef(isAway);
  const pauseIfDue = useEffectEvent((wasAway: boolean) => {
    if (shouldPauseRun({ status, wasAway, isAway })) pause();
  });
  useEffect(() => {
    pauseIfDue(wasAwayRef.current);
    wasAwayRef.current = isAway;
  }, [isAway]);
}
