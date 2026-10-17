// src/features/tasks/canvas/layout-progress-grid.ts
'worklet';

import { fitGrid } from '@/canvas/canvas-layout';

import type { ProgressGridView } from './to-view';
import type { CanvasLayout } from '@/canvas/canvas-layout';
import type { LayoutInput } from '@/canvas/canvas-types';

const PAD = 8;

export function layoutProgressGrid(input: LayoutInput<ProgressGridView>): CanvasLayout {
  const box = { x: PAD, y: PAD, width: input.width - 2 * PAD, height: input.height - 2 * PAD };
  return {
    width: input.width,
    height: input.height,
    isMirrored: input.isMirrored,
    regions: [{ id: 'grid', ...fitGrid({ box, cols: input.view.cols, rows: input.view.rows }) }],
  };
}
