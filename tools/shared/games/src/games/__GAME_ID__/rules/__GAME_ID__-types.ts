// src/games/__GAME_ID__/rules/__GAME_ID__-types.ts
import type { ApplyResult } from '@/core/game/game-engine';

/** 0 = dark, 1 = lit. Numbers, not booleans: compact in saves and readable in goldens. */
export type Cell = 0 | 1;

/**
 * Everything a run needs and nothing else, JSON-safe (plain arrays and numbers). A game that
 * draws random numbers after create() (refills, spawns, dice) also keeps its `rng: RngState` here.
 */
export type __GAME_PASCAL__State = {
  readonly cols: number;
  readonly rows: number;
  /** Row-major: index = row * cols + col. */
  readonly cells: readonly Cell[];
  readonly moves: number;
  readonly maxMoves: number;
};

/** A move says what the player chose, in board terms; applyMove decides what it does. */
export type __GAME_PASCAL__Move = {
  readonly kind: 'toggle';
  readonly col: number;
  readonly row: number;
};

/** Past tense, kebab-case, with every index the animation and the counters need. */
export type __GAME_PASCAL__Event =
  | { readonly kind: 'cells-toggled'; readonly cells: readonly number[] }
  | { readonly kind: 'board-cleared' }
  | { readonly kind: 'moves-added'; readonly count: number };

export type __GAME_PASCAL__Result = ApplyResult<__GAME_PASCAL__State, __GAME_PASCAL__Event>;
