// src/services/session/session-context.tsx
// Hands the SessionManager down and lets components read its snapshot through useSyncExternalStore
// (no state copy, no effect that sets state). The provider starts the restore on mount, and starts it
// again when the app comes to the foreground after the keychain could not be read (a background
// launch before the first unlock after a restart); a read that fails in the foreground too signs out
// (values kept) instead of checking forever. Components see the status and the account,
// never a token.
import { createContext, use, useEffect, useSyncExternalStore } from 'react';

import { useIsAppActive } from '@/hooks/use-is-app-active';

import type { SessionManager, SessionSnapshot } from './session-types';
import type { JSX, ReactNode } from 'react';

const SessionContext = createContext<SessionManager | null>(null);

export type SessionProviderProps = {
  /** Created once by the app root (createSessionManager), never inside a render. */
  readonly session: SessionManager;
  readonly children: ReactNode;
};

/**
 * Provides the session and keeps it restored. The effect runs again whenever the status or the
 * foreground changes, so a restore that ends `unavailable` while the app is (or just became)
 * active reads again in the foreground, where a second failure signs out instead of waiting.
 */
export function SessionProvider({ session, children }: SessionProviderProps): JSX.Element {
  const { status } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const isActive = useIsAppActive();
  useEffect(() => {
    if (status === 'restoring' || (status === 'unavailable' && isActive)) {
      session.start({ isForeground: isActive });
    }
  }, [session, status, isActive]);
  return <SessionContext value={session}>{children}</SessionContext>;
}

/** The session's actions (signIn, signOut, accessToken). A missing provider is a programmer error. */
export function useSessionManager(): SessionManager {
  const session = use(SessionContext);
  if (session === null) {
    throw new Error('useSessionManager() needs a <SessionProvider> above it');
  }
  return session;
}

/** The current snapshot; the component re-renders when it changes. */
export function useSessionSnapshot(): SessionSnapshot {
  const session = useSessionManager();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
