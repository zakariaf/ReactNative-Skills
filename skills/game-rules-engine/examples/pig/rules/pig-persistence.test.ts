// src/games/pig/rules/pig-persistence.test.ts
import { applyMove } from './apply-move';
import { create } from './create';
import { parseMove, parseState } from './pig-persistence';

describe('parseState', () => {
  it('returns a saved run unchanged, its stream included', () => {
    const state = applyMove(create(9, 60), { kind: 'roll' }).state;
    expect(parseState(JSON.parse(JSON.stringify(state)))).toStrictEqual(state);
  });

  it.each([
    ['text', 'garbage'],
    ['a stream of three words', { ...create(1, 0), rng: [1, 2, 3] }],
    ['a stream word above 32 bits', { ...create(1, 0), rng: [1, 2, 3, 2 ** 32] }],
    ['a negative bank', { ...create(1, 0), banked: -5 }],
    ['a missing turn count', { ...create(1, 0), turn: undefined }],
  ])('rejects %s', (_name, json) => {
    expect(parseState(json)).toBeNull();
  });
});

describe('parseMove', () => {
  it.each([[{ kind: 'roll' }], [{ kind: 'hold' }]])('accepts %j', (json) => {
    expect(parseMove(json)).toStrictEqual(json);
  });

  it.each([[null], [{ kind: 'pass' }]])('rejects %j', (json) => {
    expect(parseMove(json)).toBeNull();
  });
});
