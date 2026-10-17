// test/sims/__GAME_ID__/balance.sim.test.ts — BOT SIMULATION. Slow: `npm run test:sim` only.
// Plays every (policy, difficulty) cell of balance-bands.json over seedsPerCell seeds, writes
// reports/sim/__GAME_ID__.json, and fails when a run hangs, a replay differs or a band is missed.
import { randomPolicy } from '@/core/game/testing/play-bot';
import { bandProblems } from '@/core/game-balance/balance-bands';
import { greedyPolicy, lookaheadPolicy } from '@/core/game-balance/bot-policies';
import { parseBands } from '@/core/game-balance/parse-balance-bands';
import { summarizeCell } from '@/core/game-balance/sim-stats';
import { traceBot } from '@/core/game-balance/trace-bot';
import { applyMove } from '@/games/__GAME_ID__/rules/apply-move';
import { create } from '@/games/__GAME_ID__/rules/create';
import { listMoves } from '@/games/__GAME_ID__/rules/list-moves';
import { outcome } from '@/games/__GAME_ID__/rules/outcome';
import {
  evaluate__GAME_PASCAL__,
  scoreOf__GAME_PASCAL__,
  tag__GAME_PASCAL__Event,
} from '@/games/__GAME_ID__/testing/__GAME_ID__-bot';
import { rulesFingerprint, writeSimReport } from '@test/sims/write-sim-report';

import bandsJson from './balance-bands.json' with { type: 'json' };

import type { BotGame, BotPolicy } from '@/core/game/testing/play-bot';
import type { SimReport } from '@/core/game-balance/balance-bands';
import type { SimCell } from '@/core/game-balance/sim-stats';
import type {
  __GAME_PASCAL__Event,
  __GAME_PASCAL__Move,
  __GAME_PASCAL__State,
} from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

type State = __GAME_PASCAL__State;
type Move = __GAME_PASCAL__Move;

const GAME_ID = '__GAME_ID__';
const BANDS = parseBands(bandsJson);
const GAME: BotGame<State, Move, __GAME_PASCAL__Event> = { create, listMoves, applyMove, outcome };

/** The three standard players: the baseline, the reasonable player and the upper bound of skill. */
const POLICIES: Readonly<Record<string, () => BotPolicy<State, Move>>> = {
  random: () => randomPolicy(),
  greedy: () => greedyPolicy(GAME, evaluate__GAME_PASCAL__),
  lookahead: () => lookaheadPolicy(GAME, evaluate__GAME_PASCAL__, { depth: 2, beam: 4 }),
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
      tagEvent: tag__GAME_PASCAL__Event,
      scoreOf: scoreOf__GAME_PASCAL__,
    }),
  );
  return summarizeCell(policy, difficulty, traces);
}

describe('__GAME_ID__ balance', () => {
  // The grid runs level difficulties (0..99, the lower bound of each tuning row) and makes the
  // curve; the endless cell, if the game has one, is played once more and judged on its own bands.
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
