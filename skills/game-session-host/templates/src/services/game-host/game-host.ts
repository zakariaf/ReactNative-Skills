// src/services/game-host/game-host.ts
// createGameHost<...> is the ONLY generic seam between a typed game and the app: everything that
// touches the game's state, move, event and intent types lives in its closure (with host-runs.ts),
// so screens, stores and navigation see only the erased GameHost and SessionHandle, and no cast is
// ever needed.
import { ok } from '@/core/result';
import { openRun, savedSession } from '@/services/game-host/host-runs';

import type { GameIntent } from '@/core/game/game-input';
import type { LevelPack } from '@/core/game/levels';
import type { MessageId } from '@/core/game/messages';
import type { RunRef } from '@/core/game-results/run-ref';
import type { Result } from '@/core/result';
import type { GameRunsFailure } from '@/data/game-runs/game-runs-repository';
import type { HostRunDeps } from '@/services/game-host/host-runs';
import type { HostedGame } from '@/services/game-host/hosted-game';
import type { SessionOpen } from '@/services/game-host/open-session';
import type { SessionController } from '@/services/game-host/session-controller';
import type { SessionHandle } from '@/services/game-host/session-view';
import type { ComponentType } from 'react';

/** What the app decides per game (src/config/game-host-config.ts), checked against the rules. */
export type GameHostOptions = {
  /** Offer the game's one rescue after a loss; true only when its rules have continueRun 'once'. */
  readonly isContinueAllowed: boolean;
  /** Free hints per day before a hint is paid for; 0 when the rules have no hints. */
  readonly freeHintsPerDay: number;
};

export type BoardHostProps = { readonly testID: string };

/** What the board layer gets to draw and drive one run (typed inside the seam only). */
export type BoardHostInput<TState, TMove, TEvent, TIntent extends GameIntent> = {
  readonly game: HostedGame<TState, TMove, TEvent, TIntent>;
  readonly controller: SessionController<TState, TMove, TEvent, TIntent>;
};

/** create-board-host.tsx implements it; injected so this file loads without React Native. */
export type BoardHostFactory = <TState, TMove, TEvent, TIntent extends GameIntent>(
  input: BoardHostInput<TState, TMove, TEvent, TIntent>,
) => ComponentType<BoardHostProps>;

export type GameHostDeps = HostRunDeps & {
  readonly options: GameHostOptions;
  readonly createBoardHost: BoardHostFactory;
};

/** One opened run: the erased handle for screens and its bound board. */
export type OpenedSession = {
  readonly handle: SessionHandle;
  readonly BoardHost: ComponentType<BoardHostProps>;
};

/**
 * The saved run Home offers to continue (no game types). `shouldResumeOnLaunch` is false after
 * Pause -> Home (and after leaveSavedRun): only an app that opens the run straight on launch reads
 * it; Home offers Continue for every saved run either way.
 */
export type SavedRunInfo = { readonly ref: RunRef; readonly shouldResumeOnLaunch: boolean };

/** Test builds only: handed to the debug layer (debug-menu-and-test-hooks), never to store builds. */
export type GameDebugControls = {
  /** Ends the open run at the game's win or lose example, through the real run-end write. */
  readonly endActiveRun: (example: 'win' | 'lose') => boolean;
};

/** The app's type-erased handle on one game. */
export type GameHost = {
  readonly id: string;
  /** Catalog key of the game's name ('<id>.name'). */
  readonly nameId: MessageId;
  /** The statistics counters screens list: stored key, label key, sum or max. */
  readonly counters: readonly {
    readonly id: string;
    readonly labelId: MessageId;
    readonly aggregate: 'sum' | 'max';
  }[];
  /** The level packs (level-generation-and-solvers); [] for a game without levels. */
  readonly packs: readonly LevelPack[];
  readonly hasDaily: boolean;
  readonly hasEndless: boolean;
  readonly hasHints: boolean;
  readonly freeHintsPerDay: number;
  readonly hasTutorial: boolean;
  readonly savedRun: () => SavedRunInfo | null;
  /**
   * Builds the run (pure: nothing is written until its handle begins). null when there is no such
   * run: no saved run, an unknown level, a mode or a tutorial the game lacks.
   */
  readonly openSession: (open: SessionOpen) => OpenedSession | null;
  /**
   * The crash guard of an app that opens the saved run on launch: the Game route's error boundary
   * calls it, so a state that crashes the board lands on Home next launch instead of crash-looping.
   */
  readonly leaveSavedRun: () => Result<void, GameRunsFailure>;
  readonly debugControls: () => GameDebugControls;
};

type Game<TState, TMove, TEvent, TIntent extends GameIntent> = HostedGame<
  TState,
  TMove,
  TEvent,
  TIntent
>;

type Facts = Pick<
  GameHost,
  | 'id'
  | 'nameId'
  | 'counters'
  | 'packs'
  | 'hasDaily'
  | 'hasEndless'
  | 'hasHints'
  | 'freeHintsPerDay'
  | 'hasTutorial'
>;

/** What screens read about the game: names, counters, packs and what it offers. */
function factsOf<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  options: GameHostOptions,
): Facts {
  const { levels } = game;
  return {
    id: game.identity.id,
    nameId: game.identity.nameId,
    counters: game.stats.counters.map(({ id, labelId, aggregate }) => ({ id, labelId, aggregate })),
    packs: levels?.packs ?? [],
    hasDaily: levels?.daily.kind === 'daily',
    hasEndless: levels?.endless.kind === 'endless',
    hasHints: game.rules.hints.kind === 'solver',
    freeHintsPerDay: game.rules.hints.kind === 'solver' ? options.freeHintsPerDay : 0,
    hasTutorial: game.tutorial !== undefined,
  };
}

/** Pause -> Home without a session: the saved run stays, a relaunch lands on Home. */
function leaveSaved(runs: HostRunDeps['runs'], gameId: string): Result<void, GameRunsFailure> {
  const read = runs.savedRun(gameId);
  if (!read.ok) return read;
  return read.value === null
    ? ok(undefined)
    : runs.writeRun({ ...read.value, shouldResumeOnLaunch: false });
}

export function createGameHost<TState, TMove, TEvent, TIntent extends GameIntent>(
  game: Game<TState, TMove, TEvent, TIntent>,
  deps: GameHostDeps,
): GameHost {
  // At boot: validate the saved run with the game's own parsers; drop only an unreadable run.
  savedSession(game, deps);
  // The run on screen, set when its handle begins (never a tutorial): the debug controls act on it.
  let active: SessionController<TState, TMove, TEvent, TIntent> | null = null;
  return {
    ...factsOf(game, deps.options),
    savedRun: () => {
      const read = deps.runs.savedRun(game.identity.id);
      return read.ok && read.value !== null
        ? { ref: read.value.ref, shouldResumeOnLaunch: read.value.shouldResumeOnLaunch }
        : null;
    },
    openSession: (open) => {
      const run = openRun(game, deps, open);
      if (run === null) return null;
      const { controller } = run;
      const begin = (): void => {
        controller.handle.begin();
        if (!run.isTutorial) active = controller;
      };
      const handle = { ...controller.handle, begin };
      return { handle, BoardHost: deps.createBoardHost({ game, controller }) };
    },
    leaveSavedRun: () => leaveSaved(deps.runs, game.identity.id),
    debugControls: () => ({ endActiveRun: (example) => active?.endWith(example) ?? false }),
  };
}
