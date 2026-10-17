// src/stores/game-session/game-session-store.ts: one store per run: reduce, persist, then publish.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { ok } from '@/core/result';
import { gameSessionReducer } from '@/stores/game-session/game-session-transitions';

import type { Result } from '@/core/result';
import type {
  GameSession,
  SessionAction,
  SessionRules,
} from '@/stores/game-session/game-session-types';
import type { StoreApi } from 'zustand/vanilla';

export type GameSessionStoreState<TState, TMove, TEvent, TFailure> = {
  readonly session: GameSession<TState, TMove, TEvent>;
  /** Reduces, persists the changed run, then publishes it; a failed write publishes nothing. */
  readonly dispatch: (action: SessionAction<TState, TMove>) => Result<void, TFailure>;
};

export type GameSessionStore<TState, TMove, TEvent, TFailure> = StoreApi<
  GameSessionStoreState<TState, TMove, TEvent, TFailure>
>;

/**
 * Called with every CHANGED run before it is published (and so before it is animated): writes the
 * run, or records its end in one transaction. Committed when it returns ok.
 */
export type PersistGameSession<TState, TMove, TEvent, TFailure> = (
  session: GameSession<TState, TMove, TEvent>,
  action: SessionAction<TState, TMove>,
) => Result<void, TFailure>;

export type GameSessionStoreInput<TState, TMove, TEvent, TFailure> = {
  readonly rules: SessionRules<TState, TMove, TEvent>;
  /** startGameSession(...) for a new run, or restoreRun(...).session for a saved one. */
  readonly initial: GameSession<TState, TMove, TEvent>;
  readonly persist: PersistGameSession<TState, TMove, TEvent, TFailure>;
};

/**
 * One store per run, created by the session controller (never a module singleton, never in
 * createStores). The run is on disk before the board animates it, so a kill loses nothing.
 */
export function createGameSessionStore<TState, TMove, TEvent, TFailure>({
  rules,
  initial,
  persist,
}: GameSessionStoreInput<TState, TMove, TEvent, TFailure>): GameSessionStore<
  TState,
  TMove,
  TEvent,
  TFailure
> {
  return createStore<GameSessionStoreState<TState, TMove, TEvent, TFailure>>()((set, get) => ({
    session: initial,
    dispatch: (action) => {
      const current = get().session;
      const next = gameSessionReducer(rules, current, action);
      if (next === current) return ok(undefined); // refused: paused, decided, nothing to undo
      const saved = persist(next, action);
      if (!saved.ok) return saved;
      set({ session: next });
      return ok(undefined);
    },
  }));
}

/** Always with a selector: useGameSessionStore(store, (state) => state.session.eventSeq). */
export function useGameSessionStore<TState, TMove, TEvent, TFailure, TSlice>(
  store: GameSessionStore<TState, TMove, TEvent, TFailure>,
  selector: (state: GameSessionStoreState<TState, TMove, TEvent, TFailure>) => TSlice,
): TSlice {
  return useStore(store, selector);
}
