// test/goldens/skia-golden.ts — the pixel-golden matcher for every Skia golden (Jest 'golden'
// project, CanvasKit). Every test/goldens/**/*.golden.test.ts imports it.
// A gated file: the 0.1% tolerance changes only with the reviewer's agreement and a Gate-Change
// trailer.
import { join } from 'node:path';

import { configureToMatchImageSnapshot } from 'jest-image-snapshot';

/** 0.1% of pixels may differ (CanvasKit anti-aliasing noise); diffs land in reports/visual/diff. */
export const toMatchPixelGolden = configureToMatchImageSnapshot({
  failureThreshold: 0.001,
  failureThresholdType: 'percent',
  customDiffDir: join(process.cwd(), 'reports', 'visual', 'diff'),
});
