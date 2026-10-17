// src/games/pig/rules/pig-tuning.ts
// Every balance number of Pig, after the balance pass (game-balance-and-bots, tuning-playbook.md
// "Worked example"): maxBusts 3 -> 5, then the turn budget per row 10/12/14/16 -> 7/9/10/11. The
// endless run has its own row (no target: never won) and knobsFor checks isEndlessDifficulty first.
import { isEndlessDifficulty, rowFor } from '@/core/game/difficulty';

export type PigKnobs = {
  /** Points to bank to win (higher = harder; 0: the endless run, no target, never won). */
  readonly target: number;
  /** Turns a run may use; a hold or a bust ends a turn (fewer = harder). */
  readonly maxTurns: number;
};

/** Level rows, easiest first: a higher target with relatively fewer turns needs riskier turns. */
const LEVEL_ROWS = [
  { target: 40, maxTurns: 7 },
  { target: 60, maxTurns: 9 },
  { target: 80, maxTurns: 10 },
  { target: 100, maxTurns: 11 },
] as const satisfies readonly PigKnobs[];

/** The endless run: bank as much as you can before the turns or your luck run out. */
const ENDLESS_ROW: PigKnobs = { target: 0, maxTurns: 20 };

export const TUNING = {
  /** Faces of the die (more = longer, calmer turns). */
  dieFaces: 6,
  /** The face that busts the turn. */
  bustFace: 1,
  /** Busts in a row that end the run (fewer = harsher on pushing your luck). */
  maxBusts: 5,
  /** Points per unused turn added to the banked points when the target is reached. */
  pointsPerSpareTurn: 10,
  /** Turns the one continue gives back after running out of turns (more = kinder). */
  continueTurns: 3,
  /** Per-difficulty knobs (the table above). */
  levelRows: LEVEL_ROWS,
  /** The endless run's knobs (difficulty 100). */
  endlessRow: ENDLESS_ROW,
} as const;

/** The knobs of a difficulty 0..100: the endless row at 100, else the level row rowFor picks. */
export function knobsFor(difficulty: number): PigKnobs {
  if (isEndlessDifficulty(difficulty)) return TUNING.endlessRow;
  const row = rowFor(difficulty, TUNING.levelRows.length);
  // A reduce over the non-empty table: no unreachable `?? table[0]` branch for the coverage gate.
  return TUNING.levelRows.reduce((picked, knobs, index) => (index === row ? knobs : picked));
}
