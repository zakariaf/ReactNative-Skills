// src/services/game-host/hosted-game.ts
// What a game hands the app to be hosted: its GameModule (game-rules-engine) plus what only the app
// can type: the board component and, optionally, a scripted tutorial. The seam games face: record
// this file in contracts/architecture.json "gameFacing" so src/games/<id>/<id>-hosted.ts and the
// game's tutorial file may import it.
import type { CanvasTarget } from '@/canvas/canvas-layout';
import type { GameIntent } from '@/core/game/game-input';
import type { GameModule } from '@/core/game/game-module';
import type { MessageId } from '@/core/game/messages';
import type { ComponentType } from 'react';

/**
 * Everything the board draws and sends, as plain props: the saved state, the events of the last
 * change (animate them when eventSeq changes), the tap-then-tap selection and the bought hint.
 */
export type GameSurfaceProps<TState, TMove, TEvent, TIntent> = {
  readonly testID: string;
  readonly state: TState;
  readonly lastEvents: readonly TEvent[];
  /** Changes with every applied, undone, continued or synced move: start a new animation then. */
  readonly eventSeq: number;
  /** Paused or decided: the board stops its clock and ignores input. */
  readonly isInputEnabled: boolean;
  /**
   * The run is decided (won, or lost with or without a rescue on offer): a real-time loop stops
   * with no further save point (realtime-game-loop's isEnded; its isPaused is
   * `!isInputEnabled && !isEnded`).
   */
  readonly isEnded: boolean;
  /** The selected target of a select region (UI state, never a move), or null. */
  readonly selected: CanvasTarget | null;
  /** The hinted move for this position, or null: outline its cells. */
  readonly hintedMove: TMove | null;
  readonly onIntent: (intent: TIntent) => void;
  /**
   * A real-time board (realtime-game-loop) calls it at each save point and at the run's end with
   * `realtime.snapshot(copy)` and its input log since the run began: the host writes the run
   * through the same persist step as a move and records it once when that state decides the run.
   * A turn-based board never calls it.
   */
  readonly onSavePoint: (state: TState, moves: readonly TMove[]) => void;
};

/** What one tutorial step accepts: exactly this move, or any legal move. */
export type TutorialExpect<TMove> =
  { readonly kind: 'move'; readonly move: TMove } | { readonly kind: 'any-move' };

/** One coached step: the sentence the screen shows and the move it waits for. */
export type TutorialStep<TMove> = {
  readonly messageId: MessageId;
  readonly expect: TutorialExpect<TMove>;
};

/**
 * A scripted first run (src/games/<id>/tutorial/<id>-tutorial.ts, pure): it starts at `start()`,
 * step N accepts only its expected move, and after the last step the run plays freely. It plays in
 * memory beside the saved run, records nothing and counts nothing.
 */
export type TutorialSpec<TState, TMove> = {
  readonly start: () => TState;
  readonly steps: readonly TutorialStep<TMove>[];
};

/** A game as the app hosts it: GameModule plus its board (src/games/<id>/<id>-hosted.ts). */
export type HostedGame<TState, TMove, TEvent, TIntent extends GameIntent> = GameModule<
  TState,
  TMove,
  TEvent,
  TIntent
> & {
  readonly Surface: ComponentType<GameSurfaceProps<TState, TMove, TEvent, TIntent>>;
  /** The game's tutorial, when it has one (`{ start: 'new', ref: { kind: 'tutorial' } }` opens it). */
  readonly tutorial?: TutorialSpec<TState, TMove>;
};
