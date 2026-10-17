// src/features/root-navigator/background-flush.ts
// Buffered writes must reach storage before the operating system can end the process. The moment to
// flush is the app leaving the foreground ('active' to anything else), not only 'background': iOS
// reports 'inactive' first (app switcher, Control Center, a call) and a swipe-kill from the app switcher
// ends the process with no 'background' event; Android reports 'background' from onHostPause (Recents,
// Home, another app) and only blur/focus for the notification shade (react-native 0.86.3, RCTAppState.mm
// and AppStateModule.kt). Flushers are synchronous: after the event the JS thread may be suspended at
// any moment. Pure TypeScript.
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** A buffered writer's way to commit what it holds (a debounced draft, a batched queue). */
export type Flusher = { readonly name: string; readonly flush: () => void };

/** True on the transition out of the foreground; inactive to background flushes nothing twice. */
export function isLeavingForeground(previous: string | null | undefined, next: string): boolean {
  return previous === 'active' && next !== 'active';
}

/** Runs every flusher in order; one that throws is recorded and the others still run. */
export function runFlushers(
  flushers: readonly Flusher[],
  errorLog: Pick<ErrorLogPort, 'record'>,
): void {
  for (const flusher of flushers) {
    try {
      flusher.flush();
    } catch (thrown: unknown) {
      errorLog.record(
        'storage',
        new Error(`flush ${flusher.name} failed on leaving the foreground`, { cause: thrown }),
      );
    }
  }
}
