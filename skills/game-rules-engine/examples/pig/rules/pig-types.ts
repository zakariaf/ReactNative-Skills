// src/games/pig/rules/pig-types.ts
// Pig, the public-domain dice game, played solo: roll as often as you dare, a 1 loses the turn's
// points, hold to bank them. Reach the target within the turn budget. It draws during play, so the
// RNG stream lives in the state and every roll threads it.
import type { ApplyResult } from '@/core/game/game-engine';
import type { RngState } from '@/core/rng/sfc32';

export type PigState = {
  /** The clamped difficulty create() was given; 100 is the endless run. */
  readonly difficulty: number;
  /** Points to bank to win; 0 in the endless run, which has no target and is never won. */
  readonly target: number;
  readonly banked: number;
  /** Points rolled this turn, lost on a bust, banked on a hold. */
  readonly turnTotal: number;
  /** Turns used (a hold or a bust ends a turn). */
  readonly turn: number;
  readonly maxTurns: number;
  /** Busts in a row; a hold resets it. */
  readonly busts: number;
  readonly maxBusts: number;
  /** The seeded stream every roll draws from and advances. */
  readonly rng: RngState;
};

export type PigMove = { readonly kind: 'roll' } | { readonly kind: 'hold' };

export type PigEvent =
  | { readonly kind: 'die-rolled'; readonly face: number }
  | { readonly kind: 'turn-busted'; readonly lostPoints: number; readonly busts: number }
  | { readonly kind: 'turn-banked'; readonly points: number; readonly banked: number }
  | { readonly kind: 'target-reached'; readonly banked: number }
  | { readonly kind: 'turns-added'; readonly count: number }
  | { readonly kind: 'busts-cleared'; readonly count: number };

export type PigResult = ApplyResult<PigState, PigEvent>;
