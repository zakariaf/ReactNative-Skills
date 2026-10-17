// src/games/__GAME_ID__/rules/__GAME_ID__-persistence.test.ts
import { create } from './create';
import { __GAME_CONST___PERSISTENCE, parseMove, parseState } from './__GAME_ID__-persistence';

describe('parseState', () => {
  it('returns a saved state unchanged after a JSON round trip', () => {
    const state = create(9, 60);
    expect(parseState(JSON.parse(JSON.stringify(state)))).toStrictEqual(state);
  });

  it.each([
    ['text', 'garbage'],
    ['a missing field', { cols: 3, rows: 3, cells: [], moves: 0 }],
    ['cells of the wrong length', { cols: 3, rows: 3, cells: [0, 1], moves: 0, maxMoves: 6 }],
    ['a cell that is not 0 or 1', { ...create(1, 0), cells: [2, 0, 0, 0, 0, 0, 0, 0, 0] }],
    ['a negative move count', { ...create(1, 0), moves: -1 }],
  ])('rejects %s', (_name, json) => {
    expect(parseState(json)).toBeNull();
  });
});

describe('parseMove', () => {
  it('accepts a logged toggle', () => {
    expect(parseMove({ kind: 'toggle', col: 2, row: 0 })).toStrictEqual({
      kind: 'toggle',
      col: 2,
      row: 0,
    });
  });

  it.each([[null], [{ kind: 'toggle', col: -1, row: 0 }], [{ kind: 'jump', col: 0, row: 0 }]])(
    'rejects %j',
    (json) => {
      expect(parseMove(json)).toBeNull();
    },
  );
});

describe('__GAME_CONST___PERSISTENCE', () => {
  it('drops a run saved in an older state version (version 1 has nothing to migrate)', () => {
    expect(__GAME_CONST___PERSISTENCE.migrateState(create(1, 0), 0)).toBeNull();
  });

  it('saves after every move (a turn-based game)', () => {
    expect(__GAME_CONST___PERSISTENCE.savePolicy).toStrictEqual({ kind: 'after-every-move' });
  });
});
