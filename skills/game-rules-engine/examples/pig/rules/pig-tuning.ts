// src/games/pig/rules/pig-tuning.ts
// Every balance number of Pig. The endless run has its own row (no target: never won) and
// knobsFor checks isEndlessDifficulty before picking a level row.
import { isEndlessDifficulty, rowFor } from '@/core/game/difficulty';

export type PigKnobs = {
  /** Points to bank (0: the endless run, no target). */
  readonly target: number;
  readonly maxTurns: number;
};

/** Level rows, easiest first: a higher target needs riskier turns even with more of them. */
const LEVEL_ROWS = [
  { target: 40, maxTurns: 10 },
  { target: 60, maxTurns: 12 },
  { target: 80, maxTurns: 14 },
  { target: 100, maxTurns: 16 },
] as const satisfies readonly PigKnobs[];

/** The endless run: bank as much as you can before the turns or your luck run out. */
const ENDLESS_ROW: PigKnobs = { target: 0, maxTurns: 20 };

export const TUNING = {
  dieFaces: 6,
  /** The face that busts the turn. */
  bustFace: 1,
  /** Busts in a row that end the run. */
  maxBusts: 3,
  /** Points per unused turn added to the banked points when the target is reached. */
  pointsPerSpareTurn: 10,
  /** Turns the one continue gives back after running out of turns. */
  continueTurns: 3,
  levelRows: LEVEL_ROWS,
  endlessRow: ENDLESS_ROW,
} as const;

export function knobsFor(difficulty: number): PigKnobs {
  if (isEndlessDifficulty(difficulty)) return TUNING.endlessRow;
  const row = rowFor(difficulty, TUNING.levelRows.length);
  return TUNING.levelRows.reduce((picked, knobs, index) => (index === row ? knobs : picked));
}
