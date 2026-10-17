// src/core/game/testing/json-shape.test.ts
import { jsonOf, jsonShapeProblems } from './json-shape';

describe('jsonShapeProblems', () => {
  it('accepts plain objects, arrays, strings, finite numbers, booleans and null', () => {
    const state = { cells: [0, 1], name: 'a', isOver: false, rng: [1, 2, 3, 4], last: null };
    expect(jsonShapeProblems(state)).toStrictEqual([]);
  });

  it.each([
    [{ hp: undefined }, 'state.hp is undefined (JSON drops it)'],
    [{ hp: Number.POSITIVE_INFINITY }, 'state.hp is Infinity'],
    [{ seen: new Set([1]) }, 'state.seen is a Set, not a plain object'],
    [{ body: new Float32Array(2) }, 'state.body is a Float32Array, not a plain object'],
    [{ list: [1, () => 2] }, 'state.list[1] is a function'],
    [{ id: Symbol('x') }, 'state.id is a symbol'],
  ])('reports %j', (state, problem) => {
    expect(jsonShapeProblems(state)).toStrictEqual([problem]);
  });

  it('names the path it was given', () => {
    expect(jsonShapeProblems({ col: Number.NaN }, 'move')).toStrictEqual(['move.col is NaN']);
  });
});

describe('jsonOf', () => {
  it('writes the JSON text used to compare states and moves', () => {
    expect(jsonOf({ kind: 'toggle', col: 1 })).toBe('{"kind":"toggle","col":1}');
  });
});
