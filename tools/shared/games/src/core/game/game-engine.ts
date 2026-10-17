// src/core/game/game-engine.ts
// The pure engine every game provides. The four functions run on the JS thread, import nothing but
// src/core and obey the determinism policy, so bots, solvers, saves, replays and tests can call
// them headless, thousands of times, in Jest and in Node. The names are canonical: never rename them.

/** Result of outcome(): still playing, won with a score, or lost with a catalog reason key. */
export type Outcome =
  | { readonly kind: 'playing' }
  | { readonly kind: 'won'; readonly score: number }
  | { readonly kind: 'lost'; readonly reasonKey: string };

/** applyMove() returns the next state plus the events that explain it (animation, sound, counters). */
export type ApplyResult<TState, TEvent> = {
  readonly state: TState;
  readonly events: readonly TEvent[];
};

/**
 * The engine of a game: create a start state from (seed, difficulty), list the legal moves, apply
 * one, and rate the state. Pure functions of their arguments; the same seed and moves give the
 * same states on iOS, Android, Jest and Node.
 */
export type GameEngine<TState, TMove, TEvent> = {
  /** Same pair, same state everywhere; accepts any difficulty (clamped to 0..100); starts in play. */
  readonly create: (seed: number, difficulty: number) => TState;
  /** Every legal move in a fixed order; empty exactly when outcome is not playing. */
  readonly listMoves: (state: TState) => readonly TMove[];
  /** Never changes its input; throws RangeError for a move listMoves does not offer. */
  readonly applyMove: (state: TState, move: TMove) => ApplyResult<TState, TEvent>;
  readonly outcome: (state: TState) => Outcome;
};
