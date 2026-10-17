// src/core/game-balance/balance-bands.ts
// The balance contract of one game: which bot runs to make (the grid) and the bands their numbers
// must stay inside. It lives as JSON next to the game's sim (test/sims/<game-id>/balance-bands.json).
import { round4 } from './sim-stats';

import type { SimCell } from './sim-stats';

/** What a sim writes to reports/sim/<game-id>.json. No timestamps: a rerun gives identical bytes. */
export type SimReport = {
  readonly gameId: string;
  /**
   * sha256 of the game's rules, levels, sim, geom and testing sources, the sim file and the
   * src/core files they import (rulesFingerprint in test/sims/write-sim-report.ts).
   */
  readonly rulesFingerprint: string;
  readonly seedsPerCell: number;
  readonly maxMoves: number;
  readonly cells: readonly SimCell[];
};

export type BandMetric =
  | 'winRate'
  | 'medianMoves'
  | 'p10Moves'
  | 'p90Moves'
  | 'medianScore'
  | 'payoffPerRun'
  | 'twistPerRun';

export const BAND_METRICS: readonly BandMetric[] = [
  'winRate',
  'medianMoves',
  'p10Moves',
  'p90Moves',
  'medianScore',
  'payoffPerRun',
  'twistPerRun',
];

/** The metrics an endless run is judged on: it is never won, so every metric but winRate. */
export type EndlessMetric = Exclude<BandMetric, 'winRate'>;

/** One number that must stay inside [min, max]; `why` says in plain words what the band protects. */
export type Band = {
  readonly policy: string;
  readonly difficulty: number;
  readonly metric: BandMetric;
  readonly min: number;
  readonly max: number;
  readonly why: string;
};

/** A band of the endless cell (its policy at the endless difficulty). */
export type EndlessBand = {
  readonly metric: EndlessMetric;
  readonly min: number;
  readonly max: number;
  readonly why: string;
};

/**
 * The endless run's own cell and bands (games with an endless mode): one policy at
 * ENDLESS_DIFFICULTY, kept out of the grid so it never becomes a step of the difficulty curve.
 */
export type EndlessBands = {
  readonly policy: string;
  readonly difficulty: number;
  readonly bands: readonly EndlessBand[];
};

export type BalanceBands = {
  readonly gameId: string;
  /** 'approved' once a person has play-tested the game and accepted these numbers. */
  readonly status: 'proposed' | 'approved';
  readonly approvedOn: string | null;
  readonly seedsPerCell: number;
  readonly maxMoves: number;
  /** Policy name → level difficulties (0..99) to run it at; the lower bound of each tuning row. */
  readonly grid: Readonly<Record<string, readonly number[]>>;
  readonly bands: readonly Band[];
  /** The difficulty curve: this policy's metric must move in `direction` by `minStep` per level. */
  readonly curve: {
    readonly policy: string;
    readonly metric: BandMetric;
    readonly direction: 'up' | 'down';
    readonly minStep: number;
  };
  /** Skill must matter: each policy in `order` beats the previous by `minStep`. */
  readonly skillGap: {
    readonly difficulty: number;
    readonly metric: BandMetric;
    readonly order: readonly string[];
    readonly better: 'higher' | 'lower';
    readonly minStep: number;
  };
  /** The kill test: the first payoff within `withinMoves` moves in at least `minShare` of runs. */
  readonly firstPayoff: {
    readonly policy: string;
    readonly difficulty: number;
    readonly withinMoves: number;
    readonly minShare: number;
  };
  /** The twist must actually happen; null only for a game without a twist event. */
  readonly twist: {
    readonly policy: string;
    readonly difficulty: number;
    readonly minPerRun: number;
  } | null;
  /** The endless run's cell and bands; absent or null for a game without an endless mode. */
  readonly endless?: EndlessBands | null;
  readonly notes: string;
};

function cellOf(report: SimReport, policy: string, difficulty: number): SimCell | undefined {
  return report.cells.find((cell) => cell.policy === policy && cell.difficulty === difficulty);
}

function gridProblems(report: SimReport, bands: BalanceBands): string[] {
  const problems: string[] = [];
  if (report.gameId !== bands.gameId)
    problems.push(`report is for ${report.gameId}, bands for ${bands.gameId}`);
  if (report.seedsPerCell < bands.seedsPerCell || report.maxMoves !== bands.maxMoves)
    problems.push('report was run with other seedsPerCell or maxMoves than the bands ask');
  for (const [policy, difficulties] of Object.entries(bands.grid)) {
    for (const difficulty of difficulties) {
      const cell = cellOf(report, policy, difficulty);
      if (cell === undefined) problems.push(`${policy} d${String(difficulty)}: no cell in report`);
      else if (cell.capHits > 0)
        problems.push(
          `${policy} d${String(difficulty)}: ${String(cell.capHits)} runs hit maxMoves`,
        );
    }
  }
  return problems;
}

function bandLimitProblems(report: SimReport, bands: BalanceBands): string[] {
  return bands.bands.flatMap((band) => {
    const value = cellOf(report, band.policy, band.difficulty)?.[band.metric];
    const where = `${band.policy} d${String(band.difficulty)} ${band.metric}`;
    if (value === undefined) return [`${where}: no cell in report`];
    return value < band.min || value > band.max
      ? [`${where} = ${String(value)} is outside ${String(band.min)}..${String(band.max)}`]
      : [];
  });
}

function metricOf(
  report: SimReport,
  cell: { policy: string; difficulty: number },
  metric: BandMetric,
): number {
  return cellOf(report, cell.policy, cell.difficulty)?.[metric] ?? NaN;
}

function curveProblems(report: SimReport, bands: BalanceBands): string[] {
  const { policy, metric, direction, minStep } = bands.curve;
  const grid = bands.grid[policy];
  if (grid === undefined) return [`curve: ${policy} is not in the grid`];
  const levels = [...grid].sort((a, b) => a - b);
  const problems: string[] = [];
  let previous = Number.NaN;
  for (const [index, difficulty] of levels.entries()) {
    const value = metricOf(report, { policy, difficulty }, metric);
    // Rounded like the report: 0.6 - 0.7 is -0.09999999999999998 in floating point, not -0.1.
    const step = round4(value - previous);
    const isOk = direction === 'down' ? step <= -minStep : step >= minStep;
    if (index > 0 && !isOk)
      problems.push(
        `curve: ${policy} ${metric} goes ${String(previous)} -> ${String(value)} at d${String(difficulty)}, expected ${direction} by ${String(minStep)}`,
      );
    previous = value;
  }
  return problems;
}

function skillGapProblems(report: SimReport, bands: BalanceBands): string[] {
  const { difficulty, metric, order, better, minStep } = bands.skillGap;
  const sign = better === 'higher' ? 1 : -1;
  const problems: string[] = [];
  let previous = { policy: '', value: Number.NaN };
  for (const [index, policy] of order.entries()) {
    const value = metricOf(report, { policy, difficulty }, metric);
    const gain = round4(sign * (value - previous.value));
    if (index > 0 && (Number.isNaN(gain) || gain < minStep))
      problems.push(
        `skill gap: ${policy} (${String(value)}) does not beat ${previous.policy} (${String(previous.value)}) by ${String(minStep)} ${metric} at d${String(difficulty)}`,
      );
    previous = { policy, value };
  }
  return problems;
}

function funProblems(report: SimReport, bands: BalanceBands): string[] {
  const { policy, difficulty, withinMoves, minShare } = bands.firstPayoff;
  const share = cellOf(report, policy, difficulty)?.firstPayoffShare[withinMoves - 1] ?? 0;
  const problems =
    share < minShare
      ? [
          `first payoff: only ${String(share)} of ${policy} d${String(difficulty)} runs reach it within ${String(withinMoves)} moves (need ${String(minShare)})`,
        ]
      : [];
  const twist = bands.twist;
  if (twist === null) return problems;
  const perRun = cellOf(report, twist.policy, twist.difficulty)?.twistPerRun ?? 0;
  if (perRun < twist.minPerRun)
    problems.push(
      `twist: ${String(perRun)} twist events per ${twist.policy} d${String(twist.difficulty)} run (need ${String(twist.minPerRun)})`,
    );
  return problems;
}

function endlessProblems(report: SimReport, bands: BalanceBands): string[] {
  const endless = bands.endless ?? null;
  if (endless === null) return [];
  const where = `endless ${endless.policy} d${String(endless.difficulty)}`;
  const cell = cellOf(report, endless.policy, endless.difficulty);
  if (cell === undefined) return [`${where}: no cell in report`];
  const problems: string[] = [];
  if (cell.capHits > 0) problems.push(`${where}: ${String(cell.capHits)} runs hit maxMoves`);
  if (cell.wins > 0)
    problems.push(`${where}: ${String(cell.wins)} runs were won; an endless run only ends lost`);
  for (const band of endless.bands) {
    const value = cell[band.metric];
    if (value < band.min || value > band.max)
      problems.push(
        `${where} ${band.metric} = ${String(value)} is outside ${String(band.min)}..${String(band.max)}`,
      );
  }
  return problems;
}

/** Every way a sim report misses its game's balance contract; empty when balanced. */
export function bandProblems(report: SimReport, bands: BalanceBands): readonly string[] {
  return [
    ...gridProblems(report, bands),
    ...bandLimitProblems(report, bands),
    ...curveProblems(report, bands),
    ...skillGapProblems(report, bands),
    ...funProblems(report, bands),
    ...endlessProblems(report, bands),
  ];
}
