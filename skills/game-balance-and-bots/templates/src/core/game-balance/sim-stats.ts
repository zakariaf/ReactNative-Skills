// src/core/game-balance/sim-stats.ts
import type { BotTrace } from './trace-bot';

/** How many early moves the first-payoff curve covers (move 1 … 10). */
export const FIRST_PAYOFF_MOVES = 10;

/** One report cell: one bot policy at one difficulty over many seeds. Numbers are rounded to 4 places. */
export type SimCell = {
  readonly policy: string;
  readonly difficulty: number;
  readonly runs: number;
  readonly wins: number;
  readonly capHits: number;
  readonly winRate: number;
  readonly medianMoves: number;
  readonly p10Moves: number;
  readonly p90Moves: number;
  readonly medianScore: number;
  readonly payoffPerRun: number;
  readonly twistPerRun: number;
  /** How the lost runs ended: lose reason key → count (keys sorted, so the JSON is stable). */
  readonly lossReasons: Readonly<Record<string, number>>;
  /** Share of runs whose first payoff came at or before move k, at index k - 1. */
  readonly firstPayoffShare: readonly number[];
};

/** Four decimals: stable JSON, readable diffs, no float noise. */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Lower-interpolation percentile (p in 0…100) of a list of numbers; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.floor((p / 100) * (sorted.length - 1))]);
}

function countLossReasons(traces: readonly BotTrace[]): Record<string, number> {
  const reasons = traces.flatMap((trace) =>
    trace.outcome.kind === 'lost' ? [trace.outcome.reasonKey] : [],
  );
  return Object.fromEntries(
    [...new Set(reasons)]
      .sort()
      .map((key) => [key, reasons.filter((reason) => reason === key).length]),
  );
}

function shareBy(traces: readonly BotTrace[], move: number): number {
  const hits = traces.filter((trace) => (trace.firstAt.payoff ?? Infinity) <= move).length;
  return round4(hits / traces.length);
}

/** Summarises the traces of one policy at one difficulty into a report cell. */
export function summarizeCell(
  policy: string,
  difficulty: number,
  traces: readonly BotTrace[],
): SimCell {
  if (traces.length === 0) throw new RangeError('summarizeCell needs at least one run');
  const moves = traces.map((trace) => trace.moves);
  const wins = traces.filter((trace) => trace.outcome.kind === 'won').length;
  const total = (pick: (trace: BotTrace) => number): number =>
    traces.reduce((sum, trace) => sum + pick(trace), 0);
  return {
    policy,
    difficulty,
    runs: traces.length,
    wins,
    capHits: traces.filter((trace) => trace.isCapped).length,
    winRate: round4(wins / traces.length),
    medianMoves: percentile(moves, 50),
    p10Moves: percentile(moves, 10),
    p90Moves: percentile(moves, 90),
    medianScore: percentile(
      traces.map((trace) => trace.score),
      50,
    ),
    payoffPerRun: round4(total((trace) => trace.counts.payoff) / traces.length),
    twistPerRun: round4(total((trace) => trace.counts.twist) / traces.length),
    lossReasons: countLossReasons(traces),
    firstPayoffShare: Array.from({ length: FIRST_PAYOFF_MOVES }, (_, index) =>
      shareBy(traces, index + 1),
    ),
  };
}
