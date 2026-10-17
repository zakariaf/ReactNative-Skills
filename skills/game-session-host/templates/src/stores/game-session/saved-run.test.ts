// src/stores/game-session/saved-run.test.ts
import { TALLY_GAME } from '@test/games/tally-game';

import { gameSessionReducer, startGameSession } from './game-session-transitions';
import { restoreRun, toSavedRun } from './saved-run';

import type { GameSession, SessionAction, SessionRules } from './game-session-types';
import type { TallyEvent, TallyMove, TallyState } from '@test/games/tally-game';

type Session = GameSession<TallyState, TallyMove, TallyEvent>;

const { create, applyMove, outcome } = TALLY_GAME.engine;
const RULES: SessionRules<TallyState, TallyMove, TallyEvent> = {
  create,
  applyMove,
  outcome,
  undo: TALLY_GAME.rules.undo,
  continueRun: TALLY_GAME.rules.continueRun,
};
const TARGET = { gameId: 'tally', stateVersion: 1, shouldResumeOnLaunch: true };
const ONE: SessionAction<TallyState, TallyMove> = {
  type: 'apply-move',
  move: { kind: 'add', amount: 1 },
};

function played(actions: readonly SessionAction<TallyState, TallyMove>[]): Session {
  const first = startGameSession(RULES, {
    ref: { kind: 'level', level: 1 },
    seed: 1,
    difficulty: 1,
    startedOn: '2026-10-14',
  });
  return actions.reduce((session, action) => gameSessionReducer(RULES, session, action), first);
}

describe('toSavedRun and restoreRun', () => {
  it('writes the snapshot and the log, never the past', () => {
    const saved = toSavedRun(played([ONE, ONE]), TARGET);

    expect(saved).not.toHaveProperty('past');
    expect(saved.state).toStrictEqual({ count: 2, target: 4 });
    expect(saved.log).toHaveLength(2);
  });

  it('restores a playing run paused, with its undo history rebuilt', () => {
    const restored = restoreRun(
      RULES,
      TALLY_GAME.persistence,
      toSavedRun(played([ONE, ONE]), TARGET),
    );

    expect(restored.kind).toBe('restored');
    if (restored.kind !== 'restored') return;
    expect(restored.hasHistory).toBe(true);
    expect(restored.session.status).toBe('paused');
    expect(restored.session.past).toHaveLength(2);
  });

  it('keeps a pending loss lost (never paused), with its rescue still open', () => {
    const lost = played([ONE, ONE, ONE, { type: 'apply-move', move: { kind: 'add', amount: 2 } }]);
    const restored = restoreRun(RULES, TALLY_GAME.persistence, toSavedRun(lost, TARGET));

    expect(restored.kind === 'restored' && restored.session.status).toBe('lost');
  });

  it('drops a run its game cannot read, and one it cannot migrate', () => {
    const saved = toSavedRun(played([ONE]), TARGET);

    expect(
      restoreRun(RULES, TALLY_GAME.persistence, { ...saved, state: { count: 'x' } }),
    ).toStrictEqual({ kind: 'dropped', reason: 'state-invalid' });
    expect(restoreRun(RULES, TALLY_GAME.persistence, { ...saved, stateVersion: 0 })).toStrictEqual({
      kind: 'dropped',
      reason: 'state-not-migratable',
    });
  });

  it('keeps the snapshot and drops only the history when the replay differs', () => {
    const saved = toSavedRun(played([ONE]), TARGET);
    const restored = restoreRun(RULES, TALLY_GAME.persistence, {
      ...saved,
      state: { count: 3, target: 4 },
    });

    expect(restored.kind === 'restored' && restored.hasHistory).toBe(false);
    expect(restored.kind === 'restored' && restored.session.state).toStrictEqual({
      count: 3,
      target: 4,
    });
    expect(restored.kind === 'restored' && restored.session.hasPartialLog).toBe(true);
  });

  it('restores a save-points (real-time) run from its snapshot alone, keeping its input log', () => {
    const savePoints = {
      ...TALLY_GAME.persistence,
      savePolicy: { kind: 'save-points', points: ['pause'] },
    } as const;
    const saved = toSavedRun(played([ONE]), TARGET);
    const restored = restoreRun(RULES, savePoints, { ...saved, state: { count: 3, target: 4 } });

    expect(restored.kind === 'restored' && restored.hasHistory).toBe(true);
    expect(restored.kind === 'restored' && restored.session).toMatchObject({
      state: { count: 3, target: 4 },
      log: [{ kind: 'move', move: { kind: 'add', amount: 1 } }],
      hasPartialLog: true,
      past: [],
    });
  });

  it('drops the history when a logged move no longer parses', () => {
    const saved = toSavedRun(played([ONE]), TARGET);
    const restored = restoreRun(RULES, TALLY_GAME.persistence, {
      ...saved,
      log: [{ kind: 'move', move: { kind: 'jump' } }],
    });

    expect(restored.kind === 'restored' && restored.hasHistory).toBe(false);
  });
});
