// src/features/__FEATURE__/canvas/__SURFACE__-surface.test.ts
import { CANVAS_PALETTES } from './canvas-palettes';
import { __SURFACE_CAMEL__Surface } from './__SURFACE__-surface';

describe('__SURFACE_CAMEL__Surface', () => {
  it('describes the grid for screen readers with counted plural values', () => {
    const view = { cols: 2, rows: 2, cells: [1, 0, 1, 1], streakText: '4' };
    expect(__SURFACE_CAMEL__Surface.describe(view)).toStrictEqual({
      id: '__FEATURE__.__SURFACE__.summary',
      values: { doneCount: 3, dayCount: 4 },
    });
  });

  it('points the suggestion ring at the day an action would toggle', () => {
    const state = { cols: 7, rows: 4, cells: [], streakDays: 0 };
    expect(__SURFACE_CAMEL__Surface.targetsOf?.(state, { kind: 'toggle-day', cell: 9 })).toStrictEqual([
      { regionId: 'grid', col: 2, row: 1 },
    ]);
  });

  it('gives every palette set the same tokens', () => {
    const keys = Object.values(CANVAS_PALETTES).map((set) => Object.keys(set).sort().join());
    expect(new Set(keys).size).toBe(1);
  });
});
