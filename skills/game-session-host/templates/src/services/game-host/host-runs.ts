// src/services/game-host/host-runs.ts
// The runs one game host opens, inside the seam (it holds the typed game): the validated saved
// run, a new run that first records an abandoned decided run of the game, the tutorial that plays
// beside the saved run in memory, and each run's controller. Opening builds; nothing here writes
// until the run's handle begins (game-host.ts, useGameSession's effect).
import { ok } from '@/core/result';
import {
  entryFor,
  newSession,
  resumeSession,
  sessionRulesFor,
} from '@/services/game-host/open-session';
import { createSessionController } from '@/services/game-host/session-controller';
import { isDecided, recordFinishedRun } from '@/services/game-host/session-persist';
import { isRescuePending, startGameSession } from '@/stores/game-session/game-session-transitions';

import type { GameIntent } from '@/core/game/game-input';
import type { GameRunsRepository } from '@/data/game-runs/game-runs-repository';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { HostedGame } from '@/services/game-host/hosted-game';
import type { SessionOpen } from '@/services/game-host/open-session';
import type { ControllerDeps, SessionController } from '@/services/game-host/session-controller';
import type { ResultFeedback, Written } from '@/services/game-host/session-persist';
import type { GameSession } from '@/stores/game-session/game-session-types';

/** The host's dependencies a run needs (GameHostDeps without the board factory). */
export type HostRunDeps = {
  readonly runs: GameRunsRepository;
  readonly clock: Pick<ClockPort, 'nowMs' | 'today'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  readonly options: { readonly isContinueAllowed: boolean };
  readonly feedback: (result: ResultFeedback) => void;
  /** Test builds: a fixed seed for endless runs (a debug link replays the same run); null = the clock. */
  readonly seedOverride?: () => number | null;
};

/** One opened run: its controller, and whether it is the tutorial (never the active run). */
export type HostRun<TState, TMove, TEvent, TIntent> = {
  readonly controller: SessionController<TState, TMove, TEvent, TIntent>;
  readonly isTutorial: boolean;
};

type Game<TState, TMove, TEvent, TIntent extends GameIntent> = HostedGame<
  TState,
  TMove,
  TEvent,
  TIntent
>;
type Session<TState, TMove, TEvent> = GameSession<TState, TMove, TEvent>;
type Deps<TState, TMove, TEvent, TIntent> = ControllerDeps<TState, TMove, TEvent, TIntent>;

const UINT32_RANGE = 4_294_967_296;
const SETTLED: () => Written = () => ok(undefined);

/** A tutorial plays beside the saved run in memory: its controller's writes reach nothing. */
const NO_WRITES: GameRunsRepository = {
  savedRun: () => ok(null),
  writeRun: () => ok(undefined),
  clearRun: () => ok(undefined),
  bestScore: () => ok(null),
  hasRunEnd: () => ok(false),
  recordRunEnd: () => ok(undefined),
};

/** The saved run, read and validated; an unreadable one is dropped alone (results stay). */
export function savedSession<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  deps: HostRunDeps,
): Session<TState, TMove, TEvent> | null {
  const read = deps.runs.savedRun(game.identity.id);
  if (!read.ok || read.value === null) return null;
  const { isContinueAllowed } = deps.options;
  const session = resumeSession(game, {
    saved: read.value,
    errorLog: deps.errorLog,
    isContinueAllowed,
  });
  if (session !== null) return session;
  const cleared = deps.runs.clearRun(game.identity.id);
  if (!cleared.ok) {
    const reason = `unreadable ${game.identity.id} run not cleared: ${cleared.error.kind}`;
    deps.errorLog.record('storage', new Error(reason));
  }
  return null;
}

/** The typed parts every run of this game shares; a run overrides what differs. */
function controllerDeps<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  deps: HostRunDeps,
  session: Session<TState, TMove, TEvent>,
): Deps<TState, TMove, TEvent, TIntent> {
  return {
    gameId: game.identity.id,
    rules: sessionRulesFor(game, deps.options.isContinueAllowed),
    hud: game.rules.hud,
    counters: game.stats.counters,
    entry: entryFor(game, session.ref),
    table: game.levels?.table ?? [],
    intentToMove: game.input.intentToMove,
    gameRules: game.rules,
    persistence: game.persistence,
    examples: game.testing.examples,
    runs: deps.runs,
    nowMs: deps.clock.nowMs,
    feedback: deps.feedback,
    tutorial: null,
    settlePrevious: SETTLED,
    isWrittenOnBegin: false,
  };
}

/**
 * Before a new run replaces the saved run of its game: a decided saved run (a loss whose rescue
 * was still on offer when the player left, or a run end that failed to record) is recorded now,
 * declined, so it reaches results, statistics and streaks. A failure stops the overwrite.
 */
export function settleAbandoned<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  deps: HostRunDeps,
): Written {
  const previous = savedSession(game, deps);
  if (previous === null || !isDecided(previous)) return ok(undefined);
  const record = controllerDeps(game, deps, previous);
  const isPending = isRescuePending(record.rules, previous);
  const declined = isPending ? { ...previous, isRescueDeclined: true } : previous;
  const recorded = recordFinishedRun(record, declined);
  return recorded.ok ? ok(undefined) : recorded;
}

/** The tutorial: from its scripted start, no rescue, writing and recording nothing. */
function tutorialRun<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  deps: HostRunDeps,
): HostRun<TState, TMove, TEvent, TIntent> | null {
  const { tutorial } = game;
  if (tutorial === undefined) return null;
  const rules = { ...sessionRulesFor(game, false), create: () => tutorial.start() };
  const start = { ref: { kind: 'tutorial' }, seed: 0, difficulty: 0 } as const;
  const session = startGameSession(rules, { ...start, startedOn: deps.clock.today() });
  const base = controllerDeps(game, deps, session);
  const runDeps = { ...base, rules, runs: NO_WRITES, tutorial: tutorial.steps };
  return { controller: createSessionController(runDeps, session), isTutorial: true };
}

function firstSession<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  deps: HostRunDeps,
  open: SessionOpen,
): Session<TState, TMove, TEvent> | null {
  if (open.start === 'resume') return savedSession(game, deps);
  const clockSeed = (): number => Math.floor(deps.clock.nowMs()) % UINT32_RANGE;
  return newSession(game, {
    ref: open.ref,
    today: deps.clock.today(),
    newSeed: () => deps.seedOverride?.() ?? clockSeed(),
    isContinueAllowed: deps.options.isContinueAllowed,
  });
}

/** The run an open asks for, or null when there is none (no saved run, an unknown level). */
export function openRun<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  deps: HostRunDeps,
  open: SessionOpen,
): HostRun<TState, TMove, TEvent, TIntent> | null {
  if (open.start === 'new' && open.ref.kind === 'tutorial') return tutorialRun(game, deps);
  const session = firstSession(game, deps, open);
  if (session === null) return null;
  const isNew = open.start === 'new';
  const runDeps = {
    ...controllerDeps(game, deps, session),
    settlePrevious: isNew ? () => settleAbandoned(game, deps) : SETTLED,
    isWrittenOnBegin: isNew,
  };
  return { controller: createSessionController(runDeps, session), isTutorial: false };
}
