// src/services/game-host/run-summary.ts
// What the result screen shows about a finished run, and the record the one run-end write stores.
// Both are computed once, inside the persist step, before the result is published.
import { isScoreRule, starsFor } from '@/core/game/level-kit/star-rating';
import { measureCounters } from '@/services/game-host/measure-counters';

import type { Hud } from '@/core/game/game-rules';
import type { RatedRun, StarCount } from '@/core/game/level-kit/star-rating';
import type { LevelEntry, StarRule } from '@/core/game/levels';
import type { CounterSpec } from '@/core/game/stats';
import type { RunRef } from '@/core/game-results/run-ref';
import type { RunEndRecord } from '@/data/game-runs/game-runs-repository';
import type { GameSession, SessionRules } from '@/stores/game-session/game-session-types';

/** The result screen's facts; computed once, when the run end is recorded. */
export type RunSummary = {
  readonly ref: RunRef;
  readonly isWon: boolean;
  readonly loseReasonKey: string | null;
  readonly score: number;
  readonly moves: number;
  readonly playMs: number;
  /** 1 to 3 for a won level, 0 for losses and for daily and endless runs. */
  readonly stars: StarCount;
  /** A par-rated level's par; null for score-rated levels and every other run. */
  readonly par: number | null;
  /** Above the best recorded before this run (a won run, or any endless run; never practice). */
  readonly isNewBest: boolean;
  /**
   * A replayed daily (its date already has a result) or a tutorial: shown as practice, it changes
   * no best, statistic or streak.
   */
  readonly isPractice: boolean;
  /** The best score once this run is saved (the score line of a score-rated win). */
  readonly bestScore: number;
  /** The next level to offer after a win, or null (not a level, or the last one). */
  readonly nextLevel: number | null;
};

/** The game's parts a run end needs besides the session (createGameHost builds them). */
export type RunEndContext<TState, TMove, TEvent> = {
  readonly gameId: string;
  readonly rules: SessionRules<TState, TMove, TEvent>;
  readonly hud: (state: TState) => Hud;
  readonly counters: readonly CounterSpec<TEvent>[];
  /** The level's table entry (its star rule); null for daily and endless runs. */
  readonly entry: LevelEntry | null;
  readonly table: readonly LevelEntry[];
};

type Finished<TState, TMove, TEvent> = GameSession<TState, TMove, TEvent>;

function scoreOf<TState, TMove, TEvent>(
  session: Finished<TState, TMove, TEvent>,
  hud: (state: TState) => Hud,
): number {
  return session.outcome.kind === 'won' ? session.outcome.score : hud(session.state).score;
}

/** An endless run never wins (it has no goal), so its best counts either way; practice never. */
function isCounted(ref: RunRef, run: RatedRun, isPractice: boolean): boolean {
  return !isPractice && ref.kind !== 'tutorial' && (run.isWon || ref.kind === 'endless');
}

function starsOf(ref: RunRef, rule: StarRule | null, run: RatedRun): StarCount {
  return ref.kind === 'level' && rule !== null ? starsFor(rule, run) : 0;
}

function parOf(rule: StarRule | null): number | null {
  return rule === null || isScoreRule(rule) ? null : rule.par;
}

/** The level to offer after a won level, or null (not a level run, a loss, or the last level). */
function nextLevelOf(ref: RunRef, isWon: boolean, table: readonly LevelEntry[]): number | null {
  if (ref.kind !== 'level' || !isWon) return null;
  return table.find((entry) => entry.level === ref.level + 1)?.level ?? null;
}

/** What the repository knew before this run's end was written. */
export type RunHistory = {
  /** The best recorded for this run key before this run, or null. */
  readonly bestBefore: number | null;
  /** A replayed daily or a tutorial (session-persist.ts asks the repository). */
  readonly isPractice: boolean;
};

/** Summarises a decided run against what was recorded before it. */
export function summarizeRun<TState, TMove, TEvent>(
  session: Finished<TState, TMove, TEvent>,
  context: RunEndContext<TState, TMove, TEvent>,
  { bestBefore, isPractice }: RunHistory,
): RunSummary {
  const isWon = session.outcome.kind === 'won';
  const run: RatedRun = { isWon, moves: session.moveCount, score: scoreOf(session, context.hud) };
  const rule = context.entry?.stars ?? null;
  const isBest =
    isCounted(session.ref, run, isPractice) && (bestBefore === null || run.score > bestBefore);
  return {
    ref: session.ref,
    isWon,
    loseReasonKey: session.outcome.kind === 'lost' ? session.outcome.reasonKey : null,
    score: run.score,
    moves: run.moves,
    playMs: session.playMs,
    stars: starsOf(session.ref, rule, run),
    par: parOf(rule),
    isNewBest: isBest,
    isPractice,
    bestScore: isBest ? run.score : (bestBefore ?? 0),
    nextLevel: nextLevelOf(session.ref, isWon, context.table),
  };
}

/** The record the repository writes in ONE transaction (result, best, statistics, run cleared). */
export function runEndOf<TState, TMove, TEvent>(
  session: Finished<TState, TMove, TEvent>,
  summary: RunSummary,
  context: RunEndContext<TState, TMove, TEvent>,
): RunEndRecord {
  return {
    gameId: context.gameId,
    ref: session.ref,
    day: session.startedOn,
    isWon: summary.isWon,
    score: summary.score,
    moves: summary.moves,
    playMs: summary.playMs,
    stars: summary.stars,
    hintsUsed: session.hintsUsed,
    counters: measureCounters(context.rules, session, context.counters),
    isPractice: summary.isPractice,
  };
}
