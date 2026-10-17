// src/features/insights/canvas/layout-chart.test.ts
import fc from 'fast-check';

import { cellRect, hitTest } from '@/canvas/canvas-layout';

import { layoutChart } from './layout-chart';
import { toView } from './to-view';

const VIEW = toView(
  { weekOf: '2026-09-28', done: [3, 0, 5, 2, 4, 1, 6], goal: 4 },
  { formatNumber: String },
);

describe('layoutChart', () => {
  it('keeps every bar slot and label slot inside the canvas and hit-tests back to itself', () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 240, max: 2732 }),
          height: fc.integer({ min: 240, max: 2732 }),
          isMirrored: fc.boolean(),
        }),
        ({ width, height, isMirrored }) => {
          const layout = layoutChart({ width, height, view: VIEW, isMirrored });
          for (const regionId of ['bars', 'labels']) {
            for (let col = 0; col < 7; col += 1) {
              const rect = cellRect(layout, { regionId, col, row: 0 });
              if (rect === null) throw new Error(`missing ${regionId} slot`);
              expect(rect.x >= 0 && rect.x + rect.width <= width).toBe(true);
              expect(rect.y >= 0 && rect.y + rect.height <= height).toBe(true);
              const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              expect(hitTest(layout, centre)).toStrictEqual({ regionId, col, row: 0 });
            }
          }
        },
      ),
      { seed: 29, numRuns: 150 },
    );
  });
});
