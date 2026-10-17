// test/games/tally-runs.ts
// Tally runs for the game host's unit tests: the session rules, a new run and moves played on it.
import { newSession, sessionRulesFor } from '@/services/game-host/open-session';
import { gameSessionReducer } from '@/stores/game-session/game-session-transitions';

import { TALLY_GAME } from './tally-game';

import type { TallyEvent, TallyMove, TallyState } from './tally-game';
import type { RunRef } from '@/core/game-results/run-ref';
import type { GameSession } from '@/stores/game-session/game-session-types';

export type TallySession = GameSession<TallyState, TallyMove, TallyEvent>;

/** The tally game's session rules, with its rescue on. */
export const TALLY_RULES = sessionRulesFor(TALLY_GAME, true);

/** A new tally run (level 1 by default: target 4, par 2) started on 2026-10-14. */
export function startTally(ref: RunRef = { kind: 'level', level: 1 }): TallySession {
  const session = newSession(TALLY_GAME, {
    ref,
    today: '2026-10-14',
    newSeed: () => 3,
    isContinueAllowed: true,
  });
  if (session === null) throw new Error(`tally has no run for ${JSON.stringify(ref)}`);
  return session;
}

/** Applies "add 1" or "add 2" moves in order (ignored once the run is decided, like the store). */
export function playTally(session: TallySession, amounts: readonly (1 | 2)[]): TallySession {
  return amounts.reduce<TallySession>(
    (current, amount) =>
      gameSessionReducer(TALLY_RULES, current, {
        type: 'apply-move',
        move: { kind: 'add', amount },
      }),
    session,
  );
}
