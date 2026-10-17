// src/stores/game-session/game-session-store.test.ts
import { err, ok } from '@/core/result';
import { TALLY_GAME } from '@test/games/tally-game';

import { createGameSessionStore } from './game-session-store';
import { startGameSession } from './game-session-transitions';

import type { GameSession, SessionRules } from './game-session-types';
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
const ADD_ONE = { type: 'apply-move', move: { kind: 'add', amount: 1 } } as const;
const INITIAL = startGameSession(RULES, {
  ref: { kind: 'endless' },
  seed: 1,
  difficulty: 1,
  startedOn: '2026-10-14',
});

describe('createGameSessionStore', () => {
  it('persists a change before any subscriber sees it', () => {
    const order: string[] = [];
    const store = createGameSessionStore({
      rules: RULES,
      initial: INITIAL,
      persist: (session: Session) => {
        order.push(
          `persist ${String(session.moveCount)}, shown ${String(store.getState().session.moveCount)}`,
        );
        return ok(undefined);
      },
    });
    store.subscribe((state) => {
      order.push(`publish ${String(state.session.moveCount)}`);
    });

    expect(store.getState().dispatch(ADD_ONE)).toStrictEqual(ok(undefined));
    expect(order).toStrictEqual(['persist 1, shown 0', 'publish 1']);
  });

  it('publishes nothing when the write fails, and returns the failure', () => {
    const store = createGameSessionStore({
      rules: RULES,
      initial: INITIAL,
      persist: () => err({ kind: 'storage-full' }),
    });
    const listener = jest.fn();
    store.subscribe(listener);

    expect(store.getState().dispatch(ADD_ONE)).toStrictEqual(err({ kind: 'storage-full' }));
    expect(store.getState().session).toBe(INITIAL);
    expect(listener).not.toHaveBeenCalled();
  });

  it('writes and publishes nothing for a refused action', () => {
    const persist = jest.fn(() => ok(undefined));
    const store = createGameSessionStore({ rules: RULES, initial: INITIAL, persist });

    expect(store.getState().dispatch({ type: 'undo' })).toStrictEqual(ok(undefined));
    expect(persist).not.toHaveBeenCalled();
    expect(store.getState().session).toBe(INITIAL);
  });
});
