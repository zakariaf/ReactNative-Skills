// src/features/tasks/canvas/progress-grid-surface.ts
// Stand-in for skia-canvas-rendering's surface object (only the members touch input reads).
import { layoutProgressGrid } from './layout-progress-grid';
import { toView } from './to-view';

export const progressGridSurface = {
  isMirroredInRtl: true,
  toView,
  layout: layoutProgressGrid,
  dragLiftPt: 0,
};
