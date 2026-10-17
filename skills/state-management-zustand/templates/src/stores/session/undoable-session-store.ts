// src/stores/session/undoable-session-store.ts: one store per session: reduce, persist, then publish.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { ok } from '@/core/result';
import { undoableSessionReducer } from '@/stores/session/undoable-session-reducer';

import type { Result } from '@/core/result';
import type {
  SessionAction,
  SessionRules,
  UndoableSession,
} from '@/stores/session/undoable-session-types';
import type { StoreApi } from 'zustand/vanilla';

export type SessionStoreState<TState, TCommand, TFailure> = {
  readonly session: UndoableSession<TState, TCommand>;
  /** Reduces, writes the changed session, then publishes it; a failed write publishes nothing. */
  readonly dispatch: (action: SessionAction<TCommand>) => Result<void, TFailure>;
};

export type SessionStore<TState, TCommand, TFailure> = StoreApi<
  SessionStoreState<TState, TCommand, TFailure>
>;

/** Writes a changed session (toSavedSession) before it is published; committed when it returns ok. */
export type PersistSession<TState, TCommand, TFailure> = (
  session: UndoableSession<TState, TCommand>,
) => Result<void, TFailure>;

export type SessionStoreInput<TState, TCommand, TFailure> = {
  readonly rules: SessionRules<TState, TCommand>;
  /** startSession(...) for a new session, or restoreSession(...).session for a saved one. */
  readonly initial: UndoableSession<TState, TCommand>;
  readonly persist: PersistSession<TState, TCommand, TFailure>;
};

/** Changes worth a write: all but resuming and the running clock (they ride on the next write). */
export function sessionActionPersists(action: SessionAction<unknown>): boolean {
  return action.type !== 'resume' && action.type !== 'add-active-time';
}

/**
 * One store per session, created by the feature that runs it (never a module singleton, never in
 * createStores). The session is on disk before the view animates it, so a kill loses nothing.
 */
export function createSessionStore<TState, TCommand, TFailure>({
  rules,
  initial,
  persist,
}: SessionStoreInput<TState, TCommand, TFailure>): SessionStore<TState, TCommand, TFailure> {
  return createStore<SessionStoreState<TState, TCommand, TFailure>>()((set, get) => ({
    session: initial,
    dispatch: (action) => {
      const current = get().session;
      const next = undoableSessionReducer(rules, current, action);
      if (next === current) return ok(undefined); // refused: paused, finished, nothing to undo
      if (sessionActionPersists(action)) {
        const saved = persist(next);
        if (!saved.ok) return saved;
      }
      set({ session: next });
      return ok(undefined);
    },
  }));
}

/** Always with a selector: useUndoableSessionStore(store, (state) => state.session.revision). */
export function useUndoableSessionStore<TState, TCommand, TFailure, TSlice>(
  store: SessionStore<TState, TCommand, TFailure>,
  selector: (state: SessionStoreState<TState, TCommand, TFailure>) => TSlice,
): TSlice {
  return useStore(store, selector);
}
