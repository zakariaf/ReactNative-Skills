// src/core/game/persistence.ts
// How a run in progress is saved and read back. The app owns the storage (persistence-and-migrations);
// the game owns the shape of its state and moves, both JSON-safe.

/** When a real-time game's run is written. Never per frame. */
export type SavePoint = 'wave-end' | 'turn-end' | 'pause' | 'background' | 'level-end';

export type SavePolicy =
  | { readonly kind: 'after-every-move' }
  | { readonly kind: 'save-points'; readonly points: readonly SavePoint[] };

export type PersistenceSpec<TState, TMove> = {
  /** Bump when the shape of TState or TMove changes; add a migrateState step. */
  readonly stateVersion: number;
  /** Validates JSON from storage; null = invalid (only the run is dropped, results are kept). */
  readonly parseState: (json: unknown) => TState | null;
  /** Validates one logged move before a replay; null = only the undo history is dropped. */
  readonly parseMove: (json: unknown) => TMove | null;
  /** Upgrades a run saved by an older version; null = cannot (only the run is dropped). */
  readonly migrateState: (json: unknown, fromVersion: number) => TState | null;
  readonly savePolicy: SavePolicy;
};
