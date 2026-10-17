// src/core/game/game-rules.ts
// The rules a game declares beyond the engine functions: the top-bar line, undo, hints and the one
// continue. Pure data and pure functions; the session host (game-session-host) acts on them.
import type { ApplyResult } from '@/core/game/game-engine';
import type { Message, MessageId } from '@/core/game/messages';

/** The top bar: the score and the goal or progress line, e.g. "Moves 5 / 9". */
export type Hud = {
  readonly score: number;
  readonly goal: Message;
};

export type UndoPolicy =
  | { readonly kind: 'none' }
  | { readonly kind: 'unlimited' }
  | { readonly kind: 'limited'; readonly perLevel: number };

export type HintPolicy<TState, TMove> =
  | { readonly kind: 'none' }
  | { readonly kind: 'solver'; readonly suggest: (state: TState) => TMove | null };

/** At most one continue per level or run, offered only after a loss. */
export type ContinuePolicy<TState, TEvent> =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'once';
      readonly descriptionId: MessageId;
      /** From any way of losing, a playing state again plus the events that explain it. */
      readonly apply: (lost: TState) => ApplyResult<TState, TEvent>;
    };

export type GameRules<TState, TMove, TEvent> = {
  readonly hud: (state: TState) => Hud;
  readonly undo: UndoPolicy;
  readonly hints: HintPolicy<TState, TMove>;
  readonly continueRun: ContinuePolicy<TState, TEvent>;
};
