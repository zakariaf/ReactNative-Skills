// src/features/__FEATURE__/canvas/layout-__SURFACE__.ts
'worklet';

import { fitGrid } from '@/canvas/canvas-layout';

import type { __SURFACE_PASCAL__View } from './to-view';
import type { CanvasLayout, Rect } from '@/canvas/canvas-layout';
import type { LayoutInput } from '@/canvas/canvas-types';

const PAD = 8;

/** One 'grid' region of the largest whole-point square cells that fit. Any canvas size works. */
export function layout__SURFACE_PASCAL__(input: LayoutInput<__SURFACE_PASCAL__View>): CanvasLayout {
  const box: Rect = {
    x: PAD,
    y: PAD,
    width: input.width - 2 * PAD,
    height: input.height - 2 * PAD,
  };
  return {
    width: input.width,
    height: input.height,
    isMirrored: input.isMirrored,
    regions: [{ id: 'grid', ...fitGrid({ box, cols: input.view.cols, rows: input.view.rows }) }],
  };
}
