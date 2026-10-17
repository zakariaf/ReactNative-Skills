// src/core/game-balance/balance-bands.test.ts
import { bandProblems } from './balance-bands';

import type { BalanceBands, SimReport } from './balance-bands';
import type { SimCell } from './sim-stats';

function cell(policy: string, difficulty: number, winRate: number): SimCell {
  return {
    policy,
    difficulty,
    runs: 100,
    wins: winRate * 100,
    capHits: 0,
    winRate,
    medianMoves: 30,
    p10Moves: 20,
    p90Moves: 40,
    medianScore: 12,
    payoffPerRun: 4,
    twistPerRun: 2,
    lossReasons: {},
    firstPayoffShare: [0.95, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  };
}

const REPORT: SimReport = {
  gameId: 'demo',
  rulesFingerprint: 'abc',
  seedsPerCell: 100,
  maxMoves: 400,
  cells: [
    cell('random', 1, 0.1),
    cell('greedy', 0, 0.8),
    cell('greedy', 1, 0.5),
    cell('lookahead', 1, 0.7),
  ],
};

const BANDS: BalanceBands = {
  gameId: 'demo',
  status: 'proposed',
  approvedOn: null,
  seedsPerCell: 100,
  maxMoves: 400,
  grid: { random: [1], greedy: [0, 1], lookahead: [1] },
  bands: [
    {
      policy: 'greedy',
      difficulty: 0,
      metric: 'winRate',
      min: 0.7,
      max: 0.95,
      why: 'first levels feel winnable',
    },
  ],
  curve: { policy: 'greedy', metric: 'winRate', direction: 'down', minStep: 0.1 },
  skillGap: {
    difficulty: 1,
    metric: 'winRate',
    order: ['random', 'greedy', 'lookahead'],
    better: 'higher',
    minStep: 0.1,
  },
  firstPayoff: { policy: 'greedy', difficulty: 0, withinMoves: 1, minShare: 0.9 },
  twist: { policy: 'greedy', difficulty: 1, minPerRun: 1 },
  notes: 'demo bands',
};

const withCell = (next: SimCell): SimReport => ({
  ...REPORT,
  cells: REPORT.cells.map((old) =>
    old.policy === next.policy && old.difficulty === next.difficulty ? next : old,
  ),
});

const ENDLESS: BalanceBands['endless'] = {
  policy: 'greedy',
  difficulty: 100,
  bands: [{ metric: 'medianMoves', min: 25, max: 60, why: 'an endless run outlasts a level' }],
};

describe('bandProblems', () => {
  it('accepts a report inside every band', () => {
    expect(bandProblems(REPORT, BANDS)).toStrictEqual([]);
  });

  it('reports a number outside its band and a flat difficulty curve', () => {
    const problems = bandProblems(withCell(cell('greedy', 0, 0.55)), BANDS);
    expect(problems).toStrictEqual([
      'greedy d0 winRate = 0.55 is outside 0.7..0.95',
      'curve: greedy winRate goes 0.55 -> 0.5 at d1, expected down by 0.1',
    ]);
  });

  it('accepts a curve step and a skill gap of exactly minStep (no floating-point noise)', () => {
    const exact = {
      ...REPORT,
      cells: [
        cell('random', 1, 0.5),
        cell('greedy', 0, 0.7),
        cell('greedy', 1, 0.6),
        cell('lookahead', 1, 0.7),
      ],
    };
    // 0.6 - 0.7 and 0.6 - 0.5 are 0.09999999999999998 away in floating point.
    expect(bandProblems(exact, BANDS)).toStrictEqual([]);
  });

  it('judges the endless cell on its own bands, outside the difficulty curve', () => {
    const endlessCell = { ...cell('greedy', 100, 0), medianMoves: 40 };
    const report = { ...REPORT, cells: [...REPORT.cells, endlessCell] };
    expect(bandProblems(report, { ...BANDS, endless: ENDLESS })).toStrictEqual([]);
  });

  it('reports a missing, capped, won or out-of-band endless cell', () => {
    const bands = { ...BANDS, endless: ENDLESS };
    expect(bandProblems(REPORT, bands)).toStrictEqual(['endless greedy d100: no cell in report']);
    const bad = { ...cell('greedy', 100, 0.02), medianMoves: 12, capHits: 1 };
    expect(bandProblems({ ...REPORT, cells: [...REPORT.cells, bad] }, bands)).toStrictEqual([
      'endless greedy d100: 1 runs hit maxMoves',
      'endless greedy d100: 2 runs were won; an endless run only ends lost',
      'endless greedy d100 medianMoves = 12 is outside 25..60',
    ]);
  });

  it('reports a report made for another game or with other seeds or cap', () => {
    const other = { ...REPORT, gameId: 'other', seedsPerCell: 50, maxMoves: 100 };
    expect(bandProblems(other, BANDS)).toStrictEqual([
      'report is for other, bands for demo',
      'report was run with other seedsPerCell or maxMoves than the bands ask',
    ]);
  });

  it('reports when a smarter bot does not win more', () => {
    expect(bandProblems(withCell(cell('lookahead', 1, 0.55)), BANDS)).toStrictEqual([
      'skill gap: lookahead (0.55) does not beat greedy (0.5) by 0.1 winRate at d1',
    ]);
  });

  it('judges an upward curve, a lower-is-better skill gap and a game without a twist', () => {
    const bands: BalanceBands = {
      ...BANDS,
      curve: { policy: 'greedy', metric: 'winRate', direction: 'up', minStep: 0.1 },
      skillGap: { ...BANDS.skillGap, better: 'lower' },
      twist: null,
    };
    expect(bandProblems(REPORT, bands)).toStrictEqual([
      'curve: greedy winRate goes 0.8 -> 0.5 at d1, expected up by 0.1',
      'skill gap: greedy (0.5) does not beat random (0.1) by 0.1 winRate at d1',
      'skill gap: lookahead (0.7) does not beat greedy (0.5) by 0.1 winRate at d1',
    ]);
  });

  it('reports a curve policy the grid does not run', () => {
    const bands = { ...BANDS, curve: { ...BANDS.curve, policy: 'expert' } };
    expect(bandProblems(REPORT, bands)).toStrictEqual(['curve: expert is not in the grid']);
  });

  it('judges missing skill-gap, first-payoff and twist cells as failures, never as passes', () => {
    expect(bandProblems({ ...REPORT, cells: [] }, BANDS)).toStrictEqual(
      expect.arrayContaining([
        'skill gap: greedy (NaN) does not beat random (NaN) by 0.1 winRate at d1',
        'first payoff: only 0 of greedy d0 runs reach it within 1 moves (need 0.9)',
        'twist: 0 twist events per greedy d1 run (need 1)',
      ]),
    );
  });

  it('reports a slow first payoff, a missing twist, capped runs and missing cells', () => {
    const slow = {
      ...cell('greedy', 0, 0.8),
      firstPayoffShare: Array.from({ length: 10 }, () => 0.5),
    };
    const flat = { ...cell('greedy', 1, 0.5), twistPerRun: 0.25, capHits: 3 };
    const others = withCell(slow).cells.filter(
      (c) => c.policy !== 'random' && c !== REPORT.cells[2],
    );
    const report = { ...REPORT, cells: [...others, flat] };
    expect(bandProblems(report, BANDS)).toStrictEqual(
      expect.arrayContaining([
        'random d1: no cell in report',
        'greedy d1: 3 runs hit maxMoves',
        'first payoff: only 0.5 of greedy d0 runs reach it within 1 moves (need 0.9)',
        'twist: 0.25 twist events per greedy d1 run (need 1)',
      ]),
    );
  });
});
