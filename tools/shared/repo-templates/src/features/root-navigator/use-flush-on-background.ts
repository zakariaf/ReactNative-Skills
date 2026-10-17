// src/features/root-navigator/use-flush-on-background.ts
// The app's one lifecycle flush: AppRoot calls it once, before useCheckpointOnBackground, so on the
// shared 'background' event the buffered writes commit before the WAL is folded (AppState calls its
// listeners in the order they subscribed). Features never subscribe to AppState to save: they hand a
// Flusher to the root instead.
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { isLeavingForeground, runFlushers } from './background-flush';

import type { Flusher } from './background-flush';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** Flushes every buffered writer each time the app leaves the foreground. Call it once, in AppRoot. */
export function useFlushOnBackground(
  flushers: readonly Flusher[],
  errorLog: Pick<ErrorLogPort, 'record'>,
): void {
  useEffect(() => {
    let previous: string | null | undefined = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (isLeavingForeground(previous, next)) runFlushers(flushers, errorLog);
      previous = next;
    });
    return () => {
      subscription.remove();
    };
  }, [flushers, errorLog]);
}
