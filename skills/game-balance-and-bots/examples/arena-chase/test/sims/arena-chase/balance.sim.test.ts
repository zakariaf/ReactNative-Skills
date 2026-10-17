// test/sims/arena-chase/balance.sim.test.ts — BOT SIMULATION of a real-time game. Slow: `npm run test:sim` only.
// Plays every (policy, difficulty) cell of balance-bands.json over seedsPerCell seeds through the
// same fixed-step sim the UI thread runs (runSimBot), writes reports/sim/arena-chase.json, and fails
// when a run hangs, a replay differs or a band is missed. "Moves" are ticks (120 = 1 s), and the
// first-payoff curve counts seconds (payoffStepTicks 120).
import { bandProblems } from '@/core/game-balance/balance-bands';
import { parseBands } from '@/core/game-balance/parse-balance-bands';
import { runSimBot } from '@/core/game-balance/run-sim-bot';
import { summarizeCell } from '@/core/game-balance/sim-stats';
import {
  dodgePolicy,
  ARENA_CHASE_SIM,
  idlePolicy,
  wanderPolicy,
} from '@/games/arena-chase/testing/arena-chase-bot';
import { rulesFingerprint, writeSimReport } from '@test/sims/write-sim-report';

import bandsJson from './balance-bands.json' with { type: 'json' };

import type { SimReport } from '@/core/game-balance/balance-bands';
import type { CommandPolicy } from '@/core/game-balance/run-sim-bot';
import type { SimCell } from '@/core/game-balance/sim-stats';
import type { ArenaChaseSim } from '@/games/arena-chase/sim/arena-chase-sim';

const GAME_ID = 'arena-chase';
const BANDS = parseBands(bandsJson);
/** A person changes the stick about every 100 ms. */
const DECIDE_EVERY_TICKS = 12;
/** 120 ticks per step: firstPayoffShare[k - 1] is the share of runs with a payoff within k seconds. */
const PAYOFF_STEP_TICKS = 120;

/** The three real-time players: never moves, random directions, and the reasonable dodger. */
const POLICIES: Readonly<Record<string, CommandPolicy<ArenaChaseSim>>> = {
  idle: idlePolicy,
  wander: wanderPolicy,
  dodge: dodgePolicy,
};

function playCell(policy: string, difficulty: number): SimCell {
  const chosen = POLICIES[policy];
  if (chosen === undefined) throw new Error(`balance-bands.json names unknown policy ${policy}`);
  const traces = Array.from({ length: BANDS.seedsPerCell }, (_, index) =>
    runSimBot(ARENA_CHASE_SIM, {
      seed: index + 1,
      difficulty,
      policy: chosen,
      maxTicks: BANDS.maxMoves,
      decideEveryTicks: DECIDE_EVERY_TICKS,
      payoffStepTicks: PAYOFF_STEP_TICKS,
    }),
  );
  return summarizeCell(policy, difficulty, traces);
}

describe('arena-chase balance', () => {
  const cells = Object.entries(BANDS.grid).flatMap(([policy, difficulties]) =>
    difficulties.map((difficulty) => playCell(policy, difficulty)),
  );
  const report: SimReport = {
    gameId: GAME_ID,
    rulesFingerprint: rulesFingerprint(GAME_ID),
    seedsPerCell: BANDS.seedsPerCell,
    maxMoves: BANDS.maxMoves,
    cells,
  };

  beforeAll(() => {
    // Written before the assertions, so a failing run still leaves numbers to read.
    writeSimReport(report);
  });

  it('ends every run before the tick cap', () => {
    expect(cells.filter((cell) => cell.capHits > 0)).toStrictEqual([]);
  });

  it('replays identically for the same seeds', () => {
    const [first] = cells;
    if (first === undefined) throw new Error('the grid in balance-bands.json is empty');
    expect(playCell(first.policy, first.difficulty)).toStrictEqual(first);
  });

  it('stays inside every band of balance-bands.json', () => {
    expect(bandProblems(report, BANDS)).toStrictEqual([]);
  });
});
