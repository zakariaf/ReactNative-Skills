// test/goldens/skia-golden.ts
import { join } from 'node:path';

import { configureToMatchImageSnapshot } from 'jest-image-snapshot';

export const toMatchPixelGolden = configureToMatchImageSnapshot({
  failureThreshold: 0.001,
  failureThresholdType: 'percent',
  customDiffDir: join(process.cwd(), 'reports', 'visual', 'diff'),
});
