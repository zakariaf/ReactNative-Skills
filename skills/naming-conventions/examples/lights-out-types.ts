// src/games/lights-out/rules/lights-out-types.ts
// Games plugin: the same grammar on a public-domain puzzle. The move is imperative, the events are
// past tense, and every concrete type carries the game id in PascalCase (LightsOut...). Generic
// engine code uses type parameters (TState, TMove) instead.
export type Cell = 0 | 1;

export type LightsOutState = {
  readonly size: number;
  readonly cells: readonly Cell[];
  readonly movesUsed: number;
};

export type LightsOutMove = { readonly kind: 'toggle-cell'; readonly col: number; readonly row: number };

export type LightsOutEvent =
  | { readonly kind: 'cells-toggled'; readonly indexes: readonly number[] }
  | { readonly kind: 'board-cleared'; readonly movesUsed: number };

export type LightsOutOutcome = { readonly kind: 'playing' } | { readonly kind: 'won'; readonly movesUsed: number };
