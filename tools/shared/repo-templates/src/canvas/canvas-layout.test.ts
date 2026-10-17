// src/canvas/canvas-layout.test.ts
import fc from 'fast-check';

import { cellRect, EMPTY_LAYOUT, fitGrid, hitTest, isSameTarget } from './canvas-layout';

import type { CanvasLayout } from './canvas-layout';

function gridLayout(
  size: { width: number; height: number },
  grid: { cols: number; rows: number },
  isMirrored: boolean,
): CanvasLayout {
  const box = { x: 0, y: 0, width: size.width, height: size.height };
  return { ...size, isMirrored, regions: [{ id: 'grid', ...fitGrid({ box, ...grid }) }] };
}

const TWO_REGIONS: CanvasLayout = {
  width: 400,
  height: 600,
  isMirrored: false,
  regions: [
    { id: 'grid', x: 0, y: 0, cell: 50, cols: 8, rows: 8 },
    { id: 'tray', x: 0, y: 404, cell: 50, cols: 8, rows: 1 },
  ],
};

describe('canvas layout', () => {
  it('maps every cell centre back to the same cell at any canvas size, mirrored or not', () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 200, max: 2732 }),
          height: fc.integer({ min: 200, max: 2732 }),
        }),
        fc.record({ cols: fc.integer({ min: 3, max: 12 }), rows: fc.integer({ min: 3, max: 12 }) }),
        fc.boolean(),
        (size, grid, isMirrored) => {
          const layout = gridLayout(size, grid, isMirrored);
          for (let row = 0; row < grid.rows; row += 1) {
            for (let col = 0; col < grid.cols; col += 1) {
              const rect = cellRect(layout, { regionId: 'grid', col, row });
              if (rect === null) throw new Error('missing cell');
              const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              expect(hitTest(layout, centre)).toStrictEqual({ regionId: 'grid', col, row });
            }
          }
        },
      ),
      { seed: 11, numRuns: 200 },
    );
  });

  it('puts logical column 0 on the physical right edge when mirrored', () => {
    const layout = gridLayout({ width: 400, height: 400 }, { cols: 4, rows: 4 }, true);
    expect(cellRect(layout, { regionId: 'grid', col: 0, row: 0 })?.x).toBe(300);
  });

  it('hits a mirrored cell on the same half-open edges it is drawn with', () => {
    const layout = gridLayout({ width: 400, height: 400 }, { cols: 4, rows: 4 }, true);
    const rect = cellRect(layout, { regionId: 'grid', col: 0, row: 0 });
    expect(rect).toStrictEqual({ x: 300, y: 0, width: 100, height: 100 });
    expect(hitTest(layout, { x: 300, y: 0 })).toStrictEqual({ regionId: 'grid', col: 0, row: 0 });
    expect(hitTest(layout, { x: 200, y: 0 })).toStrictEqual({ regionId: 'grid', col: 1, row: 0 });
    expect(hitTest(layout, { x: 400, y: 0 })).toBeNull();
  });

  it('prefers the region a tap is truly inside over a neighbour reached only through the slop', () => {
    expect(hitTest(TWO_REGIONS, { x: 120, y: 405 }, 8)).toStrictEqual({
      regionId: 'tray',
      col: 2,
      row: 0,
    });
    expect(hitTest(TWO_REGIONS, { x: 120, y: 399 }, 8)).toStrictEqual({
      regionId: 'grid',
      col: 2,
      row: 7,
    });
  });

  it('gives a tap inside no region to the nearest region whose slop reaches it', () => {
    expect(hitTest(TWO_REGIONS, { x: 120, y: 403 }, 8)).toStrictEqual({
      regionId: 'tray',
      col: 2,
      row: 0,
    });
    expect(hitTest(TWO_REGIONS, { x: 120, y: 401 }, 8)).toStrictEqual({
      regionId: 'grid',
      col: 2,
      row: 7,
    });
  });

  it('keeps the whole grid inside the canvas', () => {
    const region = fitGrid({ box: { x: 0, y: 0, width: 390, height: 520 }, cols: 8, rows: 8 });
    expect(region.x + region.cell * 8).toBeLessThanOrEqual(390);
    expect(region.y + region.cell * 8).toBeLessThanOrEqual(520);
  });

  it('hits nothing before the canvas has a size', () => {
    expect(hitTest(EMPTY_LAYOUT, { x: 10, y: 10 }, 20)).toBeNull();
    expect(cellRect(EMPTY_LAYOUT, { regionId: 'grid', col: 0, row: 0 })).toBeNull();
  });

  it('compares targets by value', () => {
    const target = { regionId: 'grid', col: 1, row: 2 };
    expect(isSameTarget(target, { ...target })).toBe(true);
    expect(isSameTarget(target, { ...target, row: 3 })).toBe(false);
    expect(isSameTarget(null, null)).toBe(true);
    expect(isSameTarget(target, null)).toBe(false);
  });
});
