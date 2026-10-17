// src/services/game-host/session-view.ts
// What screens know about a run and what they may send: plain data and commands, no game types.
import type { Hud } from '@/core/game/game-rules';
import type { MessageId } from '@/core/game/messages';
import type { RunRef } from '@/core/game-results/run-ref';
import type { GameRunsFailure } from '@/data/game-runs/game-runs-repository';
import type { RunSummary } from '@/services/game-host/run-summary';
import type { SessionStatus } from '@/stores/game-session/game-session-types';

/** The rescue on the lose screen: never offered, offered now, or already used this run. */
export type ContinueState = 'none' | 'offered' | 'used';

/** The tutorial's current coached step (no game types), or null outside the script. */
export type TutorialCoach = {
  readonly messageId: MessageId;
  /** 0-based index of the step the run waits for. */
  readonly index: number;
  readonly count: number;
};

/** Everything a screen may know about the active run. */
export type SessionView = {
  readonly status: SessionStatus;
  readonly ref: RunRef;
  /** The game's top-bar line: the score and the goal message (format it with t()). */
  readonly hud: Hud;
  readonly moveCount: number;
  /** The game has undo at all (the bar leaves the tool out otherwise). */
  readonly isUndoSupported: boolean;
  /** An undo is possible right now. */
  readonly canUndo: boolean;
  /** The game offers solver hints (a price, if any, is the monetization layer's). */
  readonly isHintSupported: boolean;
  /**
   * The solver has a hint for this position right now (playing or paused): offer the hint, and so
   * take its price, only while this is true; a paid hint with nothing to show is wasted.
   */
  readonly isHintAvailable: boolean;
  /** A hint is shown for the current position (the board outlines the move). */
  readonly isHintShown: boolean;
  readonly continueState: ContinueState;
  /** The catalog key that explains the rescue ('<id>.continue.more-moves'), else null. */
  readonly continueDescriptionId: MessageId | null;
  /** The game's catalog key for the loss while the run is lost, else null. */
  readonly loseReasonKey: string | null;
  /** Set once the run end is on disk; the result screen shows only then. */
  readonly summary: RunSummary | null;
  /** The last write failed (storage full or busy): nothing changed on screen; offer a retry. */
  readonly saveFailure: GameRunsFailure | null;
  /** Changes with every applied, undone, continued or synced move. */
  readonly eventSeq: number;
  /** A tutorial run's coached step; null for every other run and after the script. */
  readonly tutorialStep: TutorialCoach | null;
};

/** What screens send. Paid perks (hint, continue) are sent only after payment. */
export type SessionCommand =
  | { readonly type: 'undo' }
  | { readonly type: 'hint' }
  | { readonly type: 'continue' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  /** The player turned the rescue down (Try again, Home): the pending loss is recorded. */
  | { readonly type: 'finish' }
  /** Pause -> Home: the run stays saved, but a relaunch lands on Home. */
  | { readonly type: 'leave' };

/** The type-erased run a screen holds (subscribe + getView fit useSyncExternalStore). */
export type SessionHandle = {
  /**
   * Starts the opened run, once (later calls do nothing): records an abandoned decided run of the
   * game, writes a new run, records a reopened loss nobody can rescue, and makes it the host's
   * active run. Opening is pure; useGameSession calls this from an effect, so a render that React
   * repeats or discards (StrictMode, concurrent rendering) writes nothing.
   */
  readonly begin: () => void;
  /** The same object until something on it changed. */
  readonly getView: () => SessionView;
  readonly subscribe: (listener: () => void) => () => void;
  readonly send: (command: SessionCommand) => void;
};
