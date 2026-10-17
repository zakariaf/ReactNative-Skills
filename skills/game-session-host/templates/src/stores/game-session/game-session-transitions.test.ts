// src/stores/game-session/game-session-transitions.test.ts
import fc from 'fast-check';

import { TALLY_GAME } from '@test/games/tally-game';

import {
  canUndo,
  gameSessionReducer,
  isRescuePending,
  startGameSession,
} from './game-session-transitions';

import type { GameSession, SessionAction, SessionRules } from './game-session-types';
import type { TallyEvent, TallyMove, TallyState } from '@test/games/tally-game';

type Session = GameSession<TallyState, TallyMove, TallyEvent>;
type Action = SessionAction<TallyState, TallyMove>;

const { create, applyMove, outcome } = TALLY_GAME.engine;
const RULES: SessionRules<TallyState, TallyMove, TallyEvent> = {
  create,
  applyMove,
  outcome,
  undo: TALLY_GAME.rules.undo,
  continueRun: TALLY_GAME.rules.continueRun,
};
const ONE: Action = { type: 'apply-move', move: { kind: 'add', amount: 1 } };
const TWO: Action = { type: 'apply-move', move: { kind: 'add', amount: 2 } };

function start(): Session {
  // difficulty 1: target 4
  return startGameSession(RULES, {
    ref: { kind: 'level', level: 1 },
    seed: 1,
    difficulty: 1,
    startedOn: '2026-10-14',
  });
}

function play(actions: readonly Action[], rules = RULES): Session {
  return actions.reduce((session, action) => gameSessionReducer(rules, session, action), start());
}

describe('gameSessionReducer', () => {
  it('applies a move with its events, the state before it and a new eventSeq', () => {
    const session = play([ONE]);

    expect(session.state).toStrictEqual({ count: 1, target: 4 });
    expect(session.past).toStrictEqual([{ count: 0, target: 4 }]);
    expect(session.lastEvents).toStrictEqual([{ kind: 'count-added', amount: 1 }]);
    expect(session.moveCount).toBe(1);
    expect(session.eventSeq).toBe(1);
  });

  it('decides the run from the rules: exactly the target wins, past it loses', () => {
    expect(play([TWO, TWO]).status).toBe('won');
    expect(play([TWO, TWO, TWO]).status).toBe('won');
    expect(play([TWO, ONE, TWO]).status).toBe('lost');
  });

  it('ignores moves while paused or decided (returns the same session)', () => {
    const paused = play([{ type: 'pause' }]);
    const won = play([TWO, TWO]);

    expect(gameSessionReducer(RULES, paused, ONE)).toBe(paused);
    expect(gameSessionReducer(RULES, won, ONE)).toBe(won);
  });

  it('undoes moves only while playing, never out of a loss', () => {
    const lost = play([TWO, ONE, TWO]);

    expect(canUndo(RULES, play([ONE]))).toBe(true);
    expect(canUndo(RULES, lost)).toBe(false);
    expect(gameSessionReducer(RULES, lost, { type: 'undo' })).toBe(lost);
    expect(play([ONE, { type: 'undo' }]).state).toStrictEqual({ count: 0, target: 4 });
  });

  it('respects a limited undo policy', () => {
    const limited = { ...RULES, undo: { kind: 'limited', perLevel: 1 } } as const;
    const session = play([ONE, ONE, { type: 'undo' }, { type: 'undo' }], limited);

    expect(session.undoCount).toBe(1);
    expect(session.moveCount).toBe(1);
  });

  it('rescues a loss once, and undo cannot cross the rescue', () => {
    const rescued = play([TWO, ONE, TWO, { type: 'use-continue' }]);

    expect(rescued.status).toBe('playing');
    expect(rescued.state).toStrictEqual({ count: 3, target: 4 });
    expect(rescued.continuesUsed).toBe(1);
    expect(canUndo(RULES, rescued)).toBe(false);

    const lostAgain = play([TWO, ONE, TWO, { type: 'use-continue' }, TWO]);

    expect(isRescuePending(RULES, lostAgain)).toBe(false);
    expect(gameSessionReducer(RULES, lostAgain, { type: 'use-continue' })).toBe(lostAgain);
  });

  it('offers no rescue when declined or when the rules have none', () => {
    const declined = play([TWO, ONE, TWO, { type: 'decline-continue' }]);
    const noRescue = { ...RULES, continueRun: { kind: 'none' } } as const;

    expect(declined.isRescueDeclined).toBe(true);
    expect(gameSessionReducer(RULES, declined, { type: 'use-continue' })).toBe(declined);
    expect(isRescuePending(noRescue, play([TWO, ONE, TWO], noRescue))).toBe(false);
  });

  it('counts hints while live (a paid hint may arrive paused) and play time only while playing', () => {
    expect(play([{ type: 'use-hint' }]).hintsUsed).toBe(1);
    expect(play([{ type: 'pause' }, { type: 'use-hint' }]).hintsUsed).toBe(1);
    expect(play([TWO, TWO, { type: 'use-hint' }]).hintsUsed).toBe(0);
    expect(play([{ type: 'add-play-time', ms: 900 }]).playMs).toBe(900);
    expect(play([{ type: 'pause' }, { type: 'add-play-time', ms: 900 }]).playMs).toBe(0);
    expect(play([{ type: 'pause' }, { type: 'resume' }]).status).toBe('playing');
  });

  it('syncs a real-time save point while live, keeping the input log, and may decide the run', () => {
    const moves = [{ kind: 'add', amount: 1 }] as const;
    const synced = play([
      { type: 'pause' },
      { type: 'sync-state', state: { count: 2, target: 4 }, moves },
    ]);

    expect(synced).toMatchObject({
      status: 'paused',
      state: { count: 2, target: 4 },
      log: [{ kind: 'move', move: { kind: 'add', amount: 1 } }],
      hasPartialLog: true,
      moveCount: 1,
    });
    expect(play([{ type: 'sync-state', state: { count: 4, target: 4 }, moves: [] }]).status).toBe(
      'won',
    );

    const won = play([TWO, TWO]);

    expect(
      gameSessionReducer(RULES, won, { type: 'sync-state', state: won.state, moves: [] }),
    ).toBe(won);
  });

  it('stages a test-build example as a partial log', () => {
    const staged = play([ONE, { type: 'stage-state', state: { count: 4, target: 4 } }]);

    expect(staged.status).toBe('won');
    expect(staged.hasPartialLog).toBe(true);
    expect(staged.log).toStrictEqual([]);
  });

  it('keeps its input unchanged and is deterministic (property)', () => {
    const actions = fc.array(
      fc.constantFrom<Action>(
        ONE,
        TWO,
        { type: 'undo' },
        { type: 'use-continue' },
        { type: 'pause' },
        { type: 'resume' },
      ),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(actions, (list) => {
        const before = start();
        const copy = structuredClone(before);
        const first = list.reduce(
          (session, action) => gameSessionReducer(RULES, session, action),
          before,
        );
        const second = list.reduce(
          (session, action) => gameSessionReducer(RULES, session, action),
          start(),
        );

        expect(before).toStrictEqual(copy);
        expect(first).toStrictEqual(second);
        expect(first.moveCount).toBe(first.log.filter((entry) => entry.kind === 'move').length);
      }),
    );
  });
});
