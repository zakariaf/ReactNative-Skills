// src/canvas/draw-kit.ts
// The canvas kit belongs to skia-canvas-rendering: its own checker judges allocation here.
import { Skia } from '@shopify/react-native-skia';

export function makeKitPaint(color: string) {
  'worklet';
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(color));
  return paint;
}
