// src/canvas/gestures/pan-intent.test.ts
import { IDLE_POINTER } from '@/canvas/canvas-types';

import { liftedPoint, panIntent } from './pan-intent';

import type { PanMode, PanRelease } from './pan-intent';
import type { CanvasLayout } from '@/canvas/canvas-layout';

const LAYOUT: CanvasLayout = {
  width: 400,
  height: 400,
  isMirrored: false,
  regions: [{ id: 'grid', x: 0, y: 0, cell: 50, cols: 8, rows: 8 }],
};
const FROM = { regionId: 'grid', col: 0, row: 0 };
const POINTER = { ...IDLE_POINTER, isDown: true, dragFrom: FROM };

/** A slow release at `at` after the finger moved by `by`, both [x, y] in canvas points. */
function release(at: readonly [number, number], by: readonly [number, number]): PanRelease {
  return {
    x: at[0],
    y: at[1],
    translationX: by[0],
    translationY: by[1],
    velocityX: 0,
    velocityY: 0,
  };
}

/** The intent a pan of the given mode yields, starting on FROM, with no drag lift. */
function intentFor(mode: PanMode, at: readonly [number, number], by: readonly [number, number]) {
  const input = { mode, pointer: POINTER, release: release(at, by), layout: LAYOUT };
  return panIntent({ ...input, dragLiftPt: 0 });
}

describe('panIntent', () => {
  it('gives no intent when the surface uses no pan', () => {
    expect(intentFor('none', [99, 9], [90, 0])).toBeNull();
  });

  it('turns a swipe release into one physical direction', () => {
    expect(intentFor('swipe', [95, 5], [90, 0])).toStrictEqual({
      kind: 'swipe',
      direction: 'right',
      from: FROM,
    });
  });

  it('turns a drag into a drag-end from the start cell to the release cell', () => {
    expect(intentFor('drag', [125, 175], [100, 150])).toStrictEqual({
      kind: 'drag-end',
      from: FROM,
      to: { regionId: 'grid', col: 2, row: 3 },
    });
  });

  it('drops a drag that did not start on a region', () => {
    const pointer = { ...POINTER, dragFrom: null };
    const input = {
      mode: 'drag',
      pointer,
      release: release([125, 175], [100, 150]),
      layout: LAYOUT,
      dragLiftPt: 0,
    } as const;
    expect(panIntent(input)).toBeNull();
  });

  it('drops a lifted drag on the cell above the finger, the cell its preview showed', () => {
    const input = { mode: 'drag', pointer: POINTER, layout: LAYOUT, dragLiftPt: 50 } as const;
    // The finger lets go in row 3 (y 175); the lifted point (y 125) is in row 2.
    expect(panIntent({ ...input, release: release([125, 175], [100, 150]) })).toStrictEqual({
      kind: 'drag-end',
      from: FROM,
      to: { regionId: 'grid', col: 2, row: 2 },
    });
  });

  it('lifts only the y coordinate, by exactly the lift', () => {
    expect(liftedPoint({ x: 12, y: 90 }, 40)).toStrictEqual({ x: 12, y: 50 });
    expect(liftedPoint({ x: 12, y: 90 }, 0)).toStrictEqual({ x: 12, y: 90 });
  });

  it('reports an aim release as its vector in canvas points', () => {
    expect(intentFor('aim', [40, 40], [-30, 60])).toStrictEqual({ kind: 'aim', dx: -30, dy: 60 });
  });
});
