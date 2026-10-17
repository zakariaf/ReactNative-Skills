// src/services/game-host/session-controller.ts
// One run's controller: reduce -> persist -> publish through the per-run store (session-persist.ts),
// beginning the run, hints, the rescue, leaving, save points, the tutorial's step gate, play time
// and the result feedback, behind a handle that names no game type. Only the game host builds it
// (it holds the typed game in its closure).
import { ok } from '@/core/result';
import { createPlayClock } from '@/services/game-host/play-clock';
import { createSessionExtras, showSaveFailure } from '@/services/game-host/session-extras';
import {
  isDecided,
  persistStep,
  recordEnd,
  writeLiveRun,
} from '@/services/game-host/session-persist';
import { sessionViewOf } from '@/services/game-host/session-view-of';
import { isTutorialMoveAccepted } from '@/services/game-host/tutorial-script';
import { createGameSessionStore } from '@/stores/game-session/game-session-store';
import { isRescuePending } from '@/stores/game-session/game-session-transitions';

import type { GameRules } from '@/core/game/game-rules';
import type { TestingSpec } from '@/core/game/testing';
import type { GameRunsFailure } from '@/data/game-runs/game-runs-repository';
import type { TutorialStep } from '@/services/game-host/hosted-game';
import type { PlayClock } from '@/services/game-host/play-clock';
import type { ExtrasBox } from '@/services/game-host/session-extras';
import type { PersistDeps, Written } from '@/services/game-host/session-persist';
import type { SessionCommand, SessionHandle, SessionView } from '@/services/game-host/session-view';
import type { GameSessionStore } from '@/stores/game-session/game-session-store';
import type { GameSession, SessionAction } from '@/stores/game-session/game-session-types';

/** The typed parts of the game one run needs; only the game host builds them. */
export type ControllerDeps<TState, TMove, TEvent, TIntent> = PersistDeps<TState, TMove, TEvent> & {
  readonly intentToMove: (state: TState, intent: TIntent) => TMove | null;
  readonly gameRules: GameRules<TState, TMove, TEvent>;
  readonly examples: TestingSpec<TState, TMove>['examples'];
  /** ClockPort.nowMs: play time is measured between commands (play-clock.ts). */
  readonly nowMs: () => number;
  /** A tutorial run's steps (each accepts only its move); null for every other run. */
  readonly tutorial: readonly TutorialStep<TMove>[] | null;
  /**
   * What must be on disk before this run's first write: for a new run, an abandoned decided run of
   * the same game recorded (game-host.ts); ok(undefined) otherwise. Retried before every write
   * until it succeeds, so a pending loss is never overwritten unrecorded.
   */
  readonly settlePrevious: () => Written;
  /** begin() writes the run at once (a new run, so Home can offer to continue it after a kill). */
  readonly isWrittenOnBegin: boolean;
};

/** The typed controller: the erased handle for screens plus the typed parts for the board host. */
export type SessionController<TState, TMove, TEvent, TIntent> = {
  readonly handle: SessionHandle;
  readonly store: GameSessionStore<TState, TMove, TEvent, GameRunsFailure>;
  /** The board's intents: the game's intentToMove decides; null means nothing happens. */
  readonly sendIntent: (intent: TIntent) => void;
  /** A real-time board's save point (GameSurfaceProps.onSavePoint): written, recorded if decided. */
  readonly savePoint: (state: TState, moves: readonly TMove[]) => void;
  /** The hinted move for the current position, or null (the board outlines it). */
  readonly hintedMove: () => TMove | null;
  /**
   * Test builds only (host.debugControls()): the run jumps to the game's win or lose example and
   * ends through the same persist step as a deciding move. False when nothing changed.
   */
  readonly endWith: (example: 'win' | 'lose') => boolean;
};

type Deps<TState, TMove, TEvent, TIntent> = ControllerDeps<TState, TMove, TEvent, TIntent>;

type Parts<TState, TMove, TEvent, TIntent> = {
  readonly deps: Deps<TState, TMove, TEvent, TIntent>;
  readonly extras: ExtrasBox<TMove>;
  readonly settle: () => Written;
  readonly store: GameSessionStore<TState, TMove, TEvent, GameRunsFailure>;
  readonly playClock: PlayClock;
};

/** Dispatches; a failed write publishes nothing, so the failure is shown through the extras. */
function dispatch<TState, TMove, TEvent, TIntent>(
  parts: Parts<TState, TMove, TEvent, TIntent>,
  action: SessionAction<TState, TMove>,
): boolean {
  const result = parts.store.getState().dispatch(action);
  if (!result.ok) showSaveFailure(parts.extras, result.error);
  return result.ok;
}

/** Adds the time since the previous command if the run was playing all that time. */
function addPlayTime<TState, TMove, TEvent, TIntent>(
  parts: Parts<TState, TMove, TEvent, TIntent>,
): void {
  const ms = parts.playClock.lap(parts.store.getState().session.status === 'playing');
  if (ms > 0) dispatch(parts, { type: 'add-play-time', ms });
}

/** Holds the solver's move for this position (playing, or paused after the hint's ad). */
function showHint<TState, TMove, TEvent, TIntent>(
  parts: Parts<TState, TMove, TEvent, TIntent>,
): void {
  const { session } = parts.store.getState();
  const hints = parts.deps.gameRules.hints;
  if (hints.kind !== 'solver' || isDecided(session)) return;
  const move = hints.suggest(session.state);
  if (move === null) return;
  const previous = parts.extras.current().hint;
  parts.extras.patch({ hint: { move, atSeq: session.eventSeq } });
  if (!dispatch(parts, { type: 'use-hint' })) {
    parts.extras.patch({ hint: previous });
    parts.extras.emit();
  }
}

/** Pause -> Home: a pending loss is recorded; a live run stays saved but will not reopen by itself. */
function leave<TState, TMove, TEvent, TIntent>(parts: Parts<TState, TMove, TEvent, TIntent>): void {
  const { session } = parts.store.getState();
  if (isRescuePending(parts.deps.rules, session)) {
    dispatch(parts, { type: 'decline-continue' });
    return;
  }
  if (isDecided(session)) return;
  const settled = parts.settle();
  const written = settled.ok ? writeLiveRun(parts.deps, session, false) : settled;
  if (!written.ok) showSaveFailure(parts.extras, written.error);
}

function runCommand<TState, TMove, TEvent, TIntent>(
  parts: Parts<TState, TMove, TEvent, TIntent>,
  command: SessionCommand,
): void {
  addPlayTime(parts);
  switch (command.type) {
    case 'hint':
      showHint(parts);
      return;
    case 'continue':
      dispatch(parts, { type: 'use-continue' });
      return;
    case 'finish':
      dispatch(parts, { type: 'decline-continue' });
      return;
    case 'leave':
      leave(parts);
      return;
    case 'undo':
    case 'pause':
    case 'resume':
      dispatch(parts, { type: command.type });
  }
}

/**
 * The run's first effect: a reopened loss nobody can rescue any more is recorded; a new run is
 * written once the previous run of the game is settled.
 */
function beginRun<TState, TMove, TEvent, TIntent>(
  parts: Parts<TState, TMove, TEvent, TIntent>,
): Written {
  const { session } = parts.store.getState();
  if (isDecided(session) && !isRescuePending(parts.deps.rules, session)) {
    return recordEnd(parts, session);
  }
  if (!parts.deps.isWrittenOnBegin) return ok(undefined);
  const settled = parts.settle();
  return settled.ok ? writeLiveRun(parts.deps, session, true) : settled;
}

/** The erased handle: the view stays the same object until the run or the extras changed. */
function makeHandle<TState, TMove, TEvent, TIntent>(
  parts: Parts<TState, TMove, TEvent, TIntent>,
): SessionHandle {
  let cachedFor: readonly [unknown, unknown] | null = null;
  let cached: SessionView | null = null;
  let isBegun = false;
  return {
    begin: () => {
      if (isBegun) return;
      isBegun = true;
      const written = beginRun(parts);
      if (written.ok) parts.extras.emit();
      else showSaveFailure(parts.extras, written.error);
    },
    getView: () => {
      const { session } = parts.store.getState();
      const extras = parts.extras.current();
      if (cached === null || cachedFor?.[0] !== session || cachedFor[1] !== extras) {
        cached = sessionViewOf(parts.deps, session, extras);
        cachedFor = [session, extras];
      }
      return cached;
    },
    subscribe: (listener) => {
      const stopStore = parts.store.subscribe(listener);
      const stopExtras = parts.extras.subscribe(listener);
      return () => {
        stopStore();
        stopExtras();
      };
    },
    send: (command) => {
      runCommand(parts, command);
    },
  };
}

/** Settles the previous run once: after it succeeded, later writes skip it. */
function onceSettled(settlePrevious: () => Written): () => Written {
  let isSettled = false;
  return () => {
    if (isSettled) return ok(undefined);
    const settled = settlePrevious();
    isSettled = settled.ok;
    return settled;
  };
}

/** A tutorial run plays only the move its current step expects ('any-move': any legal move). */
function isAccepted<TMove>(
  steps: readonly TutorialStep<TMove>[] | null,
  move: TMove,
  at: number,
): boolean {
  return steps === null || isTutorialMoveAccepted(steps, move, at);
}

export function createSessionController<TState, TMove, TEvent, TIntent>(
  deps: Deps<TState, TMove, TEvent, TIntent>,
  initial: GameSession<TState, TMove, TEvent>,
): SessionController<TState, TMove, TEvent, TIntent> {
  const extras = createSessionExtras<TMove>();
  const settle = onceSettled(deps.settlePrevious);
  const persist = persistStep({ deps, extras, settle });
  const store = createGameSessionStore({ rules: deps.rules, initial, persist });
  const parts = { deps, extras, settle, store, playClock: createPlayClock(deps.nowMs) };
  return {
    handle: makeHandle(parts),
    store,
    sendIntent: (intent) => {
      addPlayTime(parts);
      const { session } = store.getState();
      const move = deps.intentToMove(session.state, intent);
      if (move === null || !isAccepted(deps.tutorial, move, session.moveCount)) return;
      dispatch(parts, { type: 'apply-move', move });
    },
    savePoint: (state, moves) => {
      addPlayTime(parts);
      dispatch(parts, { type: 'sync-state', state, moves });
    },
    hintedMove: () => {
      const hint = extras.current().hint;
      return hint !== null && hint.atSeq === store.getState().session.eventSeq ? hint.move : null;
    },
    endWith: (example) => {
      const before = store.getState().session;
      dispatch(parts, { type: 'stage-state', state: deps.examples[example]() });
      const after = store.getState().session;
      return after !== before && isDecided(after);
    },
  };
}
