// src/features/__FEATURE__/canvas/__SURFACE__-surface.ts
import { draw__SURFACE_PASCAL__ } from './draw-__SURFACE__';
import { layout__SURFACE_PASCAL__ } from './layout-__SURFACE__';
import { toView } from './to-view';

import type { __SURFACE_PASCAL__Action, __SURFACE_PASCAL__State } from './canvas-model';
import type { CanvasToken } from './canvas-palettes';
import type { __SURFACE_PASCAL__View } from './to-view';
import type { CanvasSurface, SkiaApi } from '@/canvas/canvas-types';
import type { SkPath } from '@shopify/react-native-skia';

/** Unit-size (0…1) shapes, built ONCE per kit with the immutable path API (Skia 2.6+). */
function buildPaths(skia: SkiaApi): Readonly<Partial<Record<string, SkPath>>> {
  // The done mark: a check, so done days differ by shape as well as colour.
  const mark = skia.PathBuilder.Make()
    .moveTo(0.06, 0.52)
    .lineTo(0.2, 0.38)
    .lineTo(0.4, 0.58)
    .lineTo(0.8, 0.16)
    .lineTo(0.94, 0.3)
    .lineTo(0.4, 0.86)
    .close()
    .build();
  return { mark };
}

/** The rendering members of the surface. */
export const __SURFACE_CAMEL__Surface: CanvasSurface<
  __SURFACE_PASCAL__State,
  __SURFACE_PASCAL__View,
  CanvasToken,
  __SURFACE_PASCAL__Action
> = {
  // Days run along a time axis, which reads right to left in RTL locales.
  isMirroredInRtl: true,
  toView,
  layout: layout__SURFACE_PASCAL__,
  draw: draw__SURFACE_PASCAL__,
  buildPaths,
  describe: (view) => ({
    id: '__FEATURE__.__SURFACE__.summary',
    values: {
      doneCount: view.cells.filter((cell) => cell === 1).length,
      dayCount: view.cells.length,
    },
  }),
  // A suggestion is one day to toggle; the screen rings it (frame.highlight.hinted).
  targetsOf: (state, action) => [
    { regionId: 'grid', col: action.cell % state.cols, row: Math.floor(action.cell / state.cols) },
  ],
};
