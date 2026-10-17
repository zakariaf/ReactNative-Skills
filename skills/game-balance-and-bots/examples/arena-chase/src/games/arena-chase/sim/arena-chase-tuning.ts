// src/games/arena-chase/sim/arena-chase-tuning.ts
// Every balance number of Arena Chase, in one place. A 'worklet' module: the sim imports it on the
// UI thread. Change a knob only together with a sim run (npm run test:sim) and compare
// reports/sim/arena-chase.json before and after; test/sims/arena-chase/balance-bands.json says what
// "balanced" means. Distances are arena units (the arena is 1000 x 1000), times are ticks (120 = 1 s).
'worklet';

/** The knobs that change by difficulty row: one row per band of the level scale 0..99. */
export type DifficultyKnobs = {
  /** Chasers on the field (more is harder). */
  readonly chasers: number;
  /** Chaser speed in hundredths of a unit per tick (the player moves 400): higher is harder. */
  readonly chaserSpeed: number;
  /** Sparks to collect before the time runs out (higher is harder). */
  readonly sparkGoal: number;
};

/**
 * Level rows, easiest first; each clearly harder than the one before (the sim checks the curve).
 * Difficulty 0..99 picks a row in equal bands (three rows: 0-33, 34-66, 67-99), so a daily at a
 * medium 40-50 plays the middle row. Columns as documented on DifficultyKnobs.
 */
const LEVEL_ROWS = [
  { chasers: 2, chaserSpeed: 150, sparkGoal: 10 },
  { chasers: 3, chaserSpeed: 190, sparkGoal: 12 },
  { chasers: 4, chaserSpeed: 230, sparkGoal: 14 },
] as const satisfies readonly DifficultyKnobs[];

export const TUNING = {
  /** Hearts at the start; a chaser that touches the player takes one. */
  hearts: 3,
  /** Player speed in hundredths of a unit per tick (4 units, about half the arena per second). */
  playerSpeed: 400,
  /** A chaser this close takes a heart (larger is harder). */
  hitRadius: 26,
  /** The player collects a spark this close (larger is easier). */
  sparkRadius: 32,
  /** How far right of the start the first spark waits: the first payoff comes within a second. */
  firstSparkOffset: 150,
  /** Sparks that charge the pulse; then it fires (the twist). Fewer is easier. */
  sparksPerPulse: 3,
  /** A pulse throws every chaser this close back to the edge (larger is easier). */
  pulseRadius: 260,
  /** The round: a run that has not collected its sparks after 90 s is lost. */
  roundTicks: 10_800,
  /** Per-difficulty knobs (the table above). */
  levelRows: LEVEL_ROWS,
} as const;

/** The level scale 0..99 has this many whole difficulties (100 is the endless run). */
const LEVEL_SCALE = 100;

/**
 * The knobs of a difficulty on the one 0..100 scale: rowFor (src/core/game/difficulty.ts)
 * written out, because this 'worklet' module may call only worklets on the UI thread. A reduce
 * over the non-empty table: no unreachable `?? table[0]` branch for the coverage gate.
 */
export function knobsFor(difficulty: number): DifficultyKnobs {
  const level = Math.min(Math.max(Math.floor(difficulty), 0), LEVEL_SCALE - 1);
  const row = Math.floor((level * TUNING.levelRows.length) / LEVEL_SCALE);
  return TUNING.levelRows.reduce((picked, knobs, index) => (index === row ? knobs : picked));
}
