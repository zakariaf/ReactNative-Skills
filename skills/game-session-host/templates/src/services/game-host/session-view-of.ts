// src/services/game-host/session-view-of.ts
// The plain-data SessionView of one run, built by the session controller from the session, the
// game's rules and the controller's extras (the recorded summary, the shown hint, a failed write).
import { tutorialCoachOf } from '@/services/game-host/tutorial-script';
import { canUndo, isRescuePending } from '@/stores/game-session/game-session-transitions';

import type { GameRules } from '@/core/game/game-rules';
import type { GameRunsFailure } from '@/data/game-runs/game-runs-repository';
import type { TutorialStep } from '@/services/game-host/hosted-game';
import type { RunSummary } from '@/services/game-host/run-summary';
import type { ContinueState, SessionView } from '@/services/game-host/session-view';
import type { GameSession, SessionRules } from '@/stores/game-session/game-session-types';

/** What the controller holds beside the store: set before the store publishes, so one render sees both. */
export type SessionExtras<TMove> = {
  readonly summary: RunSummary | null;
  readonly hint: { readonly move: TMove; readonly atSeq: number } | null;
  readonly saveFailure: GameRunsFailure | null;
};

/** The game's parts the view needs. */
export type ViewDeps<TState, TMove, TEvent> = {
  readonly rules: SessionRules<TState, TMove, TEvent>;
  readonly gameRules: Pick<GameRules<TState, TMove, TEvent>, 'hud' | 'undo' | 'hints'>;
  /** A tutorial run's steps; null for every other run. */
  readonly tutorial: readonly TutorialStep<TMove>[] | null;
};

/**
 * The solver has a move for this live position. Asked once per changed view (the view is cached
 * until the run changes); a solver too slow for that belongs in a precomputed hint table.
 */
function isHintAvailableFor<TState, TMove, TEvent>(
  hints: GameRules<TState, TMove, TEvent>['hints'],
  session: Pick<GameSession<TState, TMove, TEvent>, 'status' | 'state'>,
): boolean {
  const isLive = session.status === 'playing' || session.status === 'paused';
  return hints.kind === 'solver' && isLive && hints.suggest(session.state) !== null;
}

/** Whether the one rescue is on the table: offered while a loss is pending, used once taken. */
export function continueStateOf<TState, TMove, TEvent>(
  rules: Pick<SessionRules<TState, TMove, TEvent>, 'continueRun'>,
  session: Pick<
    GameSession<TState, TMove, TEvent>,
    'status' | 'continuesUsed' | 'isRescueDeclined'
  >,
): ContinueState {
  if (rules.continueRun.kind === 'none') return 'none';
  if (session.continuesUsed > 0) return 'used';
  return isRescuePending(rules, session) ? 'offered' : 'none';
}

export function sessionViewOf<TState, TMove, TEvent>(
  deps: ViewDeps<TState, TMove, TEvent>,
  session: GameSession<TState, TMove, TEvent>,
  extras: SessionExtras<TMove>,
): SessionView {
  const { ref, moveCount, status, outcome, eventSeq } = session;
  const continueRun = deps.rules.continueRun;
  return {
    status,
    ref,
    hud: deps.gameRules.hud(session.state),
    moveCount,
    isUndoSupported: deps.gameRules.undo.kind !== 'none',
    canUndo: canUndo(deps.rules, session),
    isHintSupported: deps.gameRules.hints.kind === 'solver',
    isHintAvailable: isHintAvailableFor(deps.gameRules.hints, session),
    isHintShown: extras.hint !== null && extras.hint.atSeq === eventSeq,
    continueState: continueStateOf(deps.rules, session),
    continueDescriptionId: continueRun.kind === 'once' ? continueRun.descriptionId : null,
    loseReasonKey: outcome.kind === 'lost' ? outcome.reasonKey : null,
    summary: extras.summary,
    saveFailure: extras.saveFailure,
    eventSeq,
    tutorialStep: tutorialCoachOf(deps.tutorial, moveCount),
  };
}
