// src/services/game-host/open-session.ts
// Opening a run: the reducer's view of the game, the seed and difficulty of a new run, and a saved
// run validated by the game's own parsers.
import { dailyStart } from '@/core/game/level-kit/daily-start';
import { startGameSession } from '@/stores/game-session/game-session-transitions';
import { restoreRun } from '@/stores/game-session/saved-run';

import type { DateKey } from '@/core/dates/date-key';
import type { GameIntent } from '@/core/game/game-input';
import type { GameModule } from '@/core/game/game-module';
import type { LevelEntry } from '@/core/game/levels';
import type { RunRef } from '@/core/game-results/run-ref';
import type { SavedRun } from '@/data/game-runs/game-runs-repository';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { GameSession, SessionRules } from '@/stores/game-session/game-session-types';

/** How a Game screen opens a run: the saved one, or a new one for a level, a daily or endless. */
export type SessionOpen =
  { readonly start: 'resume' } | { readonly start: 'new'; readonly ref: RunRef };

type Module<TState, TMove, TEvent, TIntent extends GameIntent> = GameModule<
  TState,
  TMove,
  TEvent,
  TIntent
>;

/**
 * The reducer's view of the game. The app may switch the game's rescue off
 * (GameHostOptions.isContinueAllowed): the rules then offer none, so no screen shows one.
 */
export function sessionRulesFor<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Module<TState, TMove, TEvent, TIntent>,
  isContinueAllowed: boolean,
): SessionRules<TState, TMove, TEvent> {
  const { create, applyMove, outcome } = game.engine;
  const { undo, continueRun } = game.rules;
  return {
    create,
    applyMove,
    outcome,
    undo,
    continueRun: isContinueAllowed ? continueRun : { kind: 'none' },
  };
}

/** The level's table entry (seed, difficulty, stars); null for daily and endless runs. */
export function entryFor<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Module<TState, TMove, TEvent, TIntent>,
  ref: RunRef,
): LevelEntry | null {
  if (ref.kind !== 'level' || game.levels === null) return null;
  return game.levels.table.find((entry) => entry.level === ref.level) ?? null;
}

type Start = { readonly seed: number; readonly difficulty: number };

/** Seed and difficulty of a new run, or null when the game has no such level or mode. */
export function startFor<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Module<TState, TMove, TEvent, TIntent>,
  ref: RunRef,
  newSeed: () => number,
): Start | null {
  const levels = game.levels;
  if (levels === null) return null; // no levels yet: no level, daily or endless run to open
  switch (ref.kind) {
    case 'level':
      return entryFor(game, ref);
    case 'daily':
      return dailyStart(levels, ref.date); // level-generation-and-solvers' one daily formula
    case 'endless':
      return levels.endless.kind === 'endless'
        ? { seed: newSeed(), difficulty: levels.endless.difficulty }
        : null;
    case 'tutorial':
      return null; // the tutorial starts from its script (host-runs.ts), not from a seed
  }
}

export type NewRunInput = {
  readonly ref: RunRef;
  readonly today: DateKey;
  readonly newSeed: () => number;
  readonly isContinueAllowed: boolean;
};

/** A new run, or null for a level or mode the game does not have. */
export function newSession<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Module<TState, TMove, TEvent, TIntent>,
  input: NewRunInput,
): GameSession<TState, TMove, TEvent> | null {
  const start = startFor(game, input.ref, input.newSeed);
  if (start === null) return null;
  const rules = sessionRulesFor(game, input.isContinueAllowed);
  return startGameSession(rules, { ref: input.ref, startedOn: input.today, ...start });
}

export type ResumeInput = {
  readonly saved: SavedRun;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  readonly isContinueAllowed: boolean;
};

/**
 * The saved run, validated by the game's own parsers and replayed for its undo history. A run the
 * game cannot read is dropped alone (null; the caller clears it, results stay); a replay that
 * does not reproduce the snapshot keeps the position, drops the undo history and is logged.
 */
export function resumeSession<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Module<TState, TMove, TEvent, TIntent>,
  input: ResumeInput,
): GameSession<TState, TMove, TEvent> | null {
  const { saved, errorLog } = input;
  const rules = sessionRulesFor(game, input.isContinueAllowed);
  const restored = restoreRun(rules, game.persistence, saved);
  if (restored.kind === 'dropped') {
    errorLog.record('storage', new Error(`saved ${saved.gameId} run dropped: ${restored.reason}`));
    return null;
  }
  if (!restored.hasHistory && saved.log.length > 0) {
    errorLog.record(
      'storage',
      new Error(`saved ${saved.gameId} run replay differs from its snapshot; undo history dropped`),
    );
  }
  return restored.session;
}
