// src/features/__FEATURE__/canvas/layout-__SURFACE__.test.ts
import fc from 'fast-check';

import { cellRect, hitTest } from '@/canvas/canvas-layout';

import { layout__SURFACE_PASCAL__ } from './layout-__SURFACE__';

import type { __SURFACE_PASCAL__View } from './to-view';

const view = (cols: number, rows: number): __SURFACE_PASCAL__View => ({
  cols,
  rows,
  cells: Array.from({ length: cols * rows }, () => 0),
  streakText: '0',
});

describe('layout__SURFACE_PASCAL__', () => {
  it('keeps every cell inside the canvas and hit-tests its centre back to itself, at any size', () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 240, max: 2732 }),
          height: fc.integer({ min: 240, max: 2732 }),
          cols: fc.integer({ min: 3, max: 7 }),
          rows: fc.integer({ min: 3, max: 6 }),
          isMirrored: fc.boolean(),
        }),
        ({ width, height, cols, rows, isMirrored }) => {
          const layout = layout__SURFACE_PASCAL__({ width, height, view: view(cols, rows), isMirrored });
          for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
              const rect = cellRect(layout, { regionId: 'grid', col, row });
              if (rect === null) throw new Error('missing cell');
              expect(rect.x >= 0 && rect.x + rect.width <= width).toBe(true);
              expect(rect.y >= 0 && rect.y + rect.height <= height).toBe(true);
              const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              expect(hitTest(layout, centre)).toStrictEqual({ regionId: 'grid', col, row });
            }
          }
        },
      ),
      { seed: 17, numRuns: 150 },
    );
  });

  it('mirrors positions (not pixels) when the surface opts in to RTL mirroring', () => {
    const layout = layout__SURFACE_PASCAL__({
      width: 400,
      height: 400,
      view: view(4, 4),
      isMirrored: true,
    });
    const first = cellRect(layout, { regionId: 'grid', col: 0, row: 0 });
    expect(first === null ? 0 : first.x + first.width).toBeGreaterThan(300);
  });
});
