// src/features/charts/draw-bars.test.ts
import { drawBars } from './draw-helpers';

describe('drawBars', () => {
  it('stays within 200 canvas calls on the busiest frame', () => {
    let total = 0;
    const canvas = new Proxy({}, { get: () => () => (total += 1) });
    drawBars(canvas as never, [1, 2, 3], {} as never);
    expect(total).toBeLessThanOrEqual(200);
  });
});
