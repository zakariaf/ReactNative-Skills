// src/stores/game-session/game-session-transitions.ts
// The game session's reducer: pure, bound to the game's rules (so it lives outside the two-argument
// *-reducer.ts tables; game-session-host's checker runs it against a tiny game instead). Every
// refused action returns the SAME session, so the store neither writes nor renders.
import type { ApplyResult } from '@/core/game/game-engine';
import type {
  GameSession,
  RunLogEntry,
  SessionAction,
  SessionRules,
  SessionStart,
  SessionStatus,
} from '@/stores/game-session/game-session-types';

/** A new run at create(seed, difficulty): playing, unless the start is already decided. */
export function startGameSession<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  start: SessionStart,
): GameSession<TState, TMove, TEvent> {
  const state = rules.create(start.seed, start.difficulty);
  const outcome = rules.outcome(state);
  return {
    ...start,
    state,
    past: [],
    log: [],
    hasPartialLog: false,
    status: outcome.kind,
    outcome,
    moveCount: 0,
    undoCount: 0,
    hintsUsed: 0,
    continuesUsed: 0,
    isRescueDeclined: false,
    playMs: 0,
    lastEvents: [],
    eventSeq: 0,
  };
}

/** A run that is not decided yet. */
const isLive = (status: SessionStatus): boolean => status === 'playing' || status === 'paused';

type Change<TState, TMove, TEvent> = {
  readonly result: ApplyResult<TState, TEvent>;
  readonly entry: RunLogEntry<TMove>;
};

function applied<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
  change: Change<TState, TMove, TEvent>,
): GameSession<TState, TMove, TEvent> {
  const outcome = rules.outcome(change.result.state);
  return {
    ...session,
    state: change.result.state,
    outcome,
    status: outcome.kind,
    log: [...session.log, change.entry],
    lastEvents: change.result.events,
    eventSeq: session.eventSeq + 1,
  };
}

/** Moves count only while playing: a paused or decided run ignores them. */
function moved<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
  move: TMove,
): GameSession<TState, TMove, TEvent> {
  if (session.status !== 'playing') return session;
  const result = rules.applyMove(session.state, move);
  const next = applied(rules, session, { result, entry: { kind: 'move', move } });
  return { ...next, past: [...session.past, session.state], moveCount: session.moveCount + 1 };
}

/** Undo steps back over moves only, while playing: never out of a loss, never across a continue. */
export function canUndo<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
): boolean {
  if (session.status !== 'playing' || session.log.at(-1)?.kind !== 'move') return false;
  switch (rules.undo.kind) {
    case 'none':
      return false;
    case 'unlimited':
      return true;
    case 'limited':
      return session.undoCount < rules.undo.perLevel;
  }
}

function undone<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
): GameSession<TState, TMove, TEvent> {
  const previous = session.past.at(-1);
  if (previous === undefined || !canUndo(rules, session)) return session;
  return {
    ...session,
    state: previous,
    past: session.past.slice(0, -1),
    log: session.log.slice(0, -1),
    outcome: rules.outcome(previous),
    moveCount: session.moveCount - 1,
    undoCount: session.undoCount + 1,
    lastEvents: [],
    eventSeq: session.eventSeq + 1,
  };
}

/** True while a lost run may still be rescued by the game's one continue. */
export function isRescuePending<TState, TMove, TEvent>(
  rules: Pick<SessionRules<TState, TMove, TEvent>, 'continueRun'>,
  session: Pick<
    GameSession<TState, TMove, TEvent>,
    'status' | 'continuesUsed' | 'isRescueDeclined'
  >,
): boolean {
  return (
    session.status === 'lost' &&
    rules.continueRun.kind === 'once' &&
    session.continuesUsed === 0 &&
    !session.isRescueDeclined
  );
}

/** One continue per run, only after a loss; undo cannot cross it (the past is cleared). */
function continued<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
): GameSession<TState, TMove, TEvent> {
  const policy = rules.continueRun;
  if (policy.kind !== 'once' || !isRescuePending(rules, session)) return session;
  const next = applied(rules, session, {
    result: policy.apply(session.state),
    entry: { kind: 'continue' },
  });
  return { ...next, past: [], continuesUsed: 1 };
}

/** Test builds: the run stands at a staged state; its log no longer replays from the seed. */
function staged<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
  state: TState,
): GameSession<TState, TMove, TEvent> {
  if (!isLive(session.status)) return session;
  const outcome = rules.outcome(state);
  const status: SessionStatus = outcome.kind === 'playing' ? session.status : outcome.kind;
  return {
    ...session,
    state,
    outcome,
    status,
    past: [],
    log: [],
    hasPartialLog: true,
    lastEvents: [],
    eventSeq: session.eventSeq + 1,
  };
}

/**
 * A real-time game's save point: the loop's snapshot replaces the state while the run is live
 * (playing or paused), and may decide it. The log becomes the loop's input log (kept for a debug
 * replay, never replayed by the host: the sim, not applyMove, made this state).
 */
function synced<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
  action: { readonly state: TState; readonly moves: readonly TMove[] },
): GameSession<TState, TMove, TEvent> {
  if (!isLive(session.status)) return session;
  const outcome = rules.outcome(action.state);
  return {
    ...session,
    state: action.state,
    outcome,
    status: outcome.kind === 'playing' ? session.status : outcome.kind,
    past: [],
    log: action.moves.map((move) => ({ kind: 'move', move })),
    hasPartialLog: true,
    moveCount: action.moves.length,
    lastEvents: [],
    eventSeq: session.eventSeq + 1,
  };
}

function paused<TState, TMove, TEvent>(
  session: GameSession<TState, TMove, TEvent>,
  isPausing: boolean,
): GameSession<TState, TMove, TEvent> {
  if (isPausing) return session.status === 'playing' ? { ...session, status: 'paused' } : session;
  return session.status === 'paused' ? { ...session, status: 'playing' } : session;
}

/** Pure; pinned by game-session-transitions.test.ts. The store saves the result before it is shown. */
export function gameSessionReducer<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
  action: SessionAction<TState, TMove>,
): GameSession<TState, TMove, TEvent> {
  switch (action.type) {
    case 'apply-move':
      return moved(rules, session, action.move);
    case 'undo':
      return undone(rules, session);
    case 'use-continue':
      return continued(rules, session);
    case 'decline-continue':
      return isRescuePending(rules, session) ? { ...session, isRescueDeclined: true } : session;
    case 'use-hint':
      // Paused too: a hint paid for with a full-screen ad arrives while the run is paused.
      return isLive(session.status) ? { ...session, hintsUsed: session.hintsUsed + 1 } : session;
    case 'pause':
    case 'resume':
      return paused(session, action.type === 'pause');
    case 'add-play-time':
      return session.status === 'playing' && action.ms > 0
        ? { ...session, playMs: session.playMs + action.ms }
        : session;
    case 'stage-state':
      return staged(rules, session, action.state);
    case 'sync-state':
      return synced(rules, session, action);
  }
}
