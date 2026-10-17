// src/services/game-host/measure-counters.ts
import type { ApplyResult } from '@/core/game/game-engine';
import type { CounterSpec } from '@/core/game/stats';
import type { CounterValue } from '@/data/game-runs/game-runs-repository';
import type {
  GameSession,
  RunLogEntry,
  SessionRules,
} from '@/stores/game-session/game-session-types';

export type CounterTally = Readonly<Record<string, CounterValue>>;

function fold<TEvent>(
  tally: CounterTally,
  counters: readonly CounterSpec<TEvent>[],
  events: readonly TEvent[],
): CounterTally {
  const next: Record<string, CounterValue> = { ...tally };
  for (const counter of counters) {
    const measured = counter.measure(events);
    const previous = next[counter.id]?.value ?? 0;
    const value = counter.aggregate === 'sum' ? previous + measured : Math.max(previous, measured);
    next[counter.id] = { value, aggregate: counter.aggregate };
  }
  return next;
}

function replayEntry<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  state: TState,
  entry: RunLogEntry<TMove>,
): ApplyResult<TState, TEvent> {
  if (entry.kind === 'move') return rules.applyMove(state, entry.move);
  return rules.continueRun.kind === 'once' ? rules.continueRun.apply(state) : { state, events: [] };
}

type Measured<TState, TMove, TEvent> = Pick<
  GameSession<TState, TMove, TEvent>,
  'seed' | 'difficulty' | 'log' | 'hasPartialLog'
>;

/**
 * A finished run's game counters. Replays the kept move line from create(seed, difficulty) and
 * folds each counter over every move's events: undone moves never count, and a run resumed after
 * a kill measures exactly what the player kept. A partial log (restored without its history, or
 * staged by a test build) cannot be measured: every counter is 0.
 */
export function measureCounters<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: Measured<TState, TMove, TEvent>,
  counters: readonly CounterSpec<TEvent>[],
): CounterTally {
  let tally = fold({}, counters, []);
  if (session.hasPartialLog) return tally;
  let state = rules.create(session.seed, session.difficulty);
  for (const entry of session.log) {
    const result = replayEntry(rules, state, entry);
    tally = fold(tally, counters, result.events);
    state = result.state;
  }
  return tally;
}
