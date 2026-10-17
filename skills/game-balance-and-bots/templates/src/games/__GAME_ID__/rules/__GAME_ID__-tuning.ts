// src/games/__GAME_ID__/rules/__GAME_ID__-tuning.ts
// Every balance number of the game, in one place. The rules import these and contain no other
// balance numbers. Change a knob only together with a bot simulation run (game-balance-and-bots)
// and compare its report before and after; a change after levels have shipped regenerates them.
// This template game (Lights Out with a move budget) has no endless mode. A game with one adds an
// endless row (no goal: never won) and returns it first in knobsFor when
// isEndlessDifficulty(difficulty) is true.
import { clampDifficulty, rowFor } from '@/core/game/difficulty';

/** The knobs that change by difficulty row: one row per band of the level scale 0..99. */
export type DifficultyKnobs = {
  /** Cells per side of the square board (bigger = harder: more cells to think about). */
  readonly side: number;
};

/**
 * Level rows, easiest first; each clearly harder than the one before (a bot simulation checks the
 * curve). Difficulty 0..99 picks a row with rowFor (three rows: 0-33, 34-66, 67-99).
 */
const LEVEL_ROWS = [
  { side: 3 },
  { side: 4 },
  { side: 5 },
] as const satisfies readonly DifficultyKnobs[];

export const TUNING = {
  /** Scramble presses at difficulty 0; a level's par is at most its presses (more = harder). */
  minPresses: 2,
  /** One more scramble press every this many difficulty points (lower = a steeper climb). */
  difficultyPerPress: 10,
  /** Moves the player gets per scramble press (more = kinder). */
  movesPerPress: 3,
  /** Points per move left over when the board goes dark (the win's score). */
  pointsPerSpareMove: 10,
  /** Moves the one continue gives back (more = kinder). */
  continueMoves: 3,
  /** Per-difficulty knobs (the table above). */
  levelRows: LEVEL_ROWS,
} as const;

/** The knobs of a difficulty (0..100, clamped): the level row rowFor picks. */
export function knobsFor(difficulty: number): DifficultyKnobs {
  const row = rowFor(difficulty, TUNING.levelRows.length);
  // A reduce over the non-empty table: no unreachable `?? table[0]` branch for the coverage gate.
  return TUNING.levelRows.reduce((picked, knobs, index) => (index === row ? knobs : picked));
}

/** Scramble presses for a difficulty: minPresses, then one more every difficultyPerPress points. */
export function pressesFor(difficulty: number): number {
  return TUNING.minPresses + Math.floor(clampDifficulty(difficulty) / TUNING.difficultyPerPress);
}
