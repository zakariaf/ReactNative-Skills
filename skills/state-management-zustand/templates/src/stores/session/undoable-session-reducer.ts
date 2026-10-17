// src/stores/session/undoable-session-reducer.ts: the session's rules; pure, the store only persists and publishes.
import type {
  SessionAction,
  SessionRules,
  SessionStatus,
  UndoableSession,
} from '@/stores/session/undoable-session-types';

function statusOf<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  state: TState,
): SessionStatus {
  return rules.isFinished(state) ? 'finished' : 'active';
}

/** A new session at `start`: active, unless `start` is already finished. */
export function startSession<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  start: TState,
): UndoableSession<TState, TCommand> {
  return {
    start,
    state: start,
    past: [],
    log: [],
    status: statusOf(rules, start),
    undoCount: 0,
    activeMs: 0,
    revision: 0,
  };
}

function applied<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  session: UndoableSession<TState, TCommand>,
  command: TCommand,
): UndoableSession<TState, TCommand> {
  if (session.status !== 'active') return session;
  const state = rules.apply(session.state, command);
  if (state === session.state) return session; // the rules refused it
  return {
    ...session,
    state,
    past: [...session.past, session.state],
    log: [...session.log, command],
    status: statusOf(rules, state),
    revision: session.revision + 1,
  };
}

/** True when undo may step back now: active, something to undo, and the policy allows another. */
export function canUndo<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  session: UndoableSession<TState, TCommand>,
): boolean {
  if (session.status !== 'active' || session.past.length === 0) return false;
  switch (rules.undo.kind) {
    case 'none':
      return false;
    case 'unlimited':
      return true;
    case 'limited':
      return session.undoCount < rules.undo.max;
  }
}

function undone<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  session: UndoableSession<TState, TCommand>,
): UndoableSession<TState, TCommand> {
  const previous = session.past.at(-1);
  if (previous === undefined || !canUndo(rules, session)) return session;
  return {
    ...session,
    state: previous,
    past: session.past.slice(0, -1),
    log: session.log.slice(0, -1),
    undoCount: session.undoCount + 1,
    revision: session.revision + 1,
  };
}

/** Pure. Every refused action returns the same session, so the store neither writes nor renders. */
export function undoableSessionReducer<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  session: UndoableSession<TState, TCommand>,
  action: SessionAction<TCommand>,
): UndoableSession<TState, TCommand> {
  switch (action.type) {
    case 'apply-command':
      return applied(rules, session, action.command);
    case 'undo':
      return undone(rules, session);
    case 'pause':
      return session.status === 'active' ? { ...session, status: 'paused' } : session;
    case 'resume':
      return session.status === 'paused' ? { ...session, status: 'active' } : session;
    case 'add-active-time':
      return session.status === 'active' && action.ms > 0
        ? { ...session, activeMs: session.activeMs + action.ms }
        : session;
  }
}
