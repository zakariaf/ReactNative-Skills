// src/stores/session/undoable-session-types.ts: an editing session with undo, as plain data.

/** How far back undo may go. */
export type UndoPolicy =
  | { readonly kind: 'none' }
  | { readonly kind: 'unlimited' }
  | { readonly kind: 'limited'; readonly max: number };

/** The parts of a feature's rules the session reducer needs; pure functions only. */
export type SessionRules<TState, TCommand> = {
  /** The next state, or the SAME object when the command does not apply (the session ignores it). */
  readonly apply: (state: TState, command: TCommand) => TState;
  /** True once the session is over (a finished checklist, a solved puzzle): commands stop. */
  readonly isFinished: (state: TState) => boolean;
  readonly undo: UndoPolicy;
};

export type SessionStatus = 'active' | 'paused' | 'finished';

/** One session, held by a per-session store; written (without `past`) before it is published. */
export type UndoableSession<TState, TCommand> = {
  /** Where the session began: the origin the log replays from. */
  readonly start: TState;
  readonly state: TState;
  /** The state before each command still in the log (memory only; replay rebuilds it on restore). */
  readonly past: readonly TState[];
  /** The applied commands since `start`, minus the undone ones. */
  readonly log: readonly TCommand[];
  readonly status: SessionStatus;
  readonly undoCount: number;
  /** Milliseconds spent active. Time arrives in add-active-time, never from a clock in here. */
  readonly activeMs: number;
  /** Changes on every applied command and undo: a view animates when it changes. */
  readonly revision: number;
};

/** Imperative kebab-case actions. */
export type SessionAction<TCommand> =
  | { readonly type: 'apply-command'; readonly command: TCommand }
  | { readonly type: 'undo' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'add-active-time'; readonly ms: number };
