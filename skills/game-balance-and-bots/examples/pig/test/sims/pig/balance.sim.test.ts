// test/sims/pig/balance.sim.test.ts — BOT SIMULATION. Slow: `npm run test:sim` only.
// Plays every (policy, difficulty) cell of balance-bands.json over seedsPerCell seeds, then the
// endless cell, writes reports/sim/pig.json, and fails when a run hangs, a replay differs or a band
// is missed. Pig draws during play, so its reasonable player is a rule (hold at 20), not greedyPolicy.
import { randomPolicy } from '@/core/game/testing/play-bot';
import { bandProblems } from '@/core/game-balance/balance-bands';
import { lookaheadPolicy } from '@/core/game-balance/bot-policies';
import { parseBands } from '@/core/game-balance/parse-balance-bands';
import { summarizeCell } from '@/core/game-balance/sim-stats';
import { traceBot } from '@/core/game-balance/trace-bot';
import { create } from '@/games/pig/rules/create';
import {
  PIG_SEARCH,
  evaluatePig,
  pigBot,
  scoreOfPig,
  tagPigEvent,
} from '@/games/pig/testing/pig-bot';
import { rulesFingerprint, writeSimReport } from '@test/sims/write-sim-report';

import bandsJson from './balance-bands.json' with { type: 'json' };

import type { BotGame, BotPolicy } from '@/core/game/testing/play-bot';
import type { SimReport } from '@/core/game-balance/balance-bands';
import type { SimCell } from '@/core/game-balance/sim-stats';
import type { PigEvent, PigMove, PigState } from '@/games/pig/rules/pig-types';

const GAME_ID = 'pig';
const BANDS = parseBands(bandsJson);
const GAME: BotGame<PigState, PigMove, PigEvent> = { create, ...PIG_SEARCH };

/** The baseline, the reasonable player (a rule a person follows) and the upper bound of skill. */
const POLICIES: Readonly<Record<string, () => BotPolicy<PigState, PigMove>>> = {
  random: () => randomPolicy(),
  holdAt20: () => pigBot,
  // It sees the next rolls (the stream is in the state): an upper bound no person reaches.
  lookahead: () => lookaheadPolicy(PIG_SEARCH, evaluatePig, { depth: 2, beam: 2 }),
};

function playCell(policy: string, difficulty: number): SimCell {
  const makePolicy = POLICIES[policy];
  if (makePolicy === undefined)
    throw new Error(`balance-bands.json names unknown policy ${policy}`);
  const traces = Array.from({ length: BANDS.seedsPerCell }, (_, index) =>
    traceBot(GAME, {
      seed: index + 1,
      difficulty,
      policy: makePolicy(),
      maxMoves: BANDS.maxMoves,
      tagEvent: tagPigEvent,
      scoreOf: scoreOfPig,
    }),
  );
  return summarizeCell(policy, difficulty, traces);
}

describe('pig balance', () => {
  const endless = BANDS.endless ?? null;
  const cells = [
    ...Object.entries(BANDS.grid).flatMap(([policy, difficulties]) =>
      difficulties.map((difficulty) => playCell(policy, difficulty)),
    ),
    ...(endless === null ? [] : [playCell(endless.policy, endless.difficulty)]),
  ];
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

  it('ends every run before the move cap', () => {
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
