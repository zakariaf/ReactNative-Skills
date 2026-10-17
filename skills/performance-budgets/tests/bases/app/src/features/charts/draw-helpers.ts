// src/features/charts/draw-helpers.ts
import { Skia } from '@shopify/react-native-skia';

import type { SkCanvas, SkPaint } from '@shopify/react-native-skia';

// Allocated once at module scope, reused every frame.
export const BAR_PAINT: SkPaint = Skia.Paint();

export function drawBars(canvas: SkCanvas, values: readonly number[], paint: SkPaint): void {
  'worklet';
  values.forEach((value, index) => {
    canvas.drawRect({ x: index * 10, y: 0, width: 8, height: value }, paint);
  });
}
