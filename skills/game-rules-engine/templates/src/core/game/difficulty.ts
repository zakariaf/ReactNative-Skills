// src/core/game/difficulty.ts
// The one difficulty scale of every game: whole numbers 0..100, the range a saved run may hold.
// Levels and the daily use 0..99 (MAX_LEVEL_DIFFICULTY); 100 (ENDLESS_DIFFICULTY) is reserved for
// the endless run, and only a game with an endless mode gives it that meaning.
// An endless run is create(freshSeed, ENDLESS_DIFFICULTY): there is no mode argument.

/** The difficulty an endless run passes to create; never won, only survived. */
export const ENDLESS_DIFFICULTY = 100;

/** The top of the level scale (levels, packs and the daily stay at or below it). */
export const MAX_LEVEL_DIFFICULTY = 99;

/** Any number -> a whole difficulty 0..100 (what create() stores in the state). */
export function clampDifficulty(difficulty: number): number {
  return Math.min(Math.max(Math.floor(difficulty), 0), ENDLESS_DIFFICULTY);
}

/** True for the endless run's difficulty (100 after clamping). */
export function isEndlessDifficulty(difficulty: number): boolean {
  return clampDifficulty(difficulty) === ENDLESS_DIFFICULTY;
}

/**
 * The row of a tuning table with `rowCount` rows (easiest first) for a level difficulty: the level
 * scale 0..99 is split into equal bands, so with four rows 0-24 is row 0 and 75-99 is row 3.
 * The endless difficulty maps to the last row; a table with an endless row checks
 * isEndlessDifficulty first.
 */
export function rowFor(difficulty: number, rowCount: number): number {
  const level = Math.min(Math.max(Math.floor(difficulty), 0), MAX_LEVEL_DIFFICULTY);
  return Math.floor((level * rowCount) / (MAX_LEVEL_DIFFICULTY + 1));
}
