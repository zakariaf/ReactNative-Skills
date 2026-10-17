// src/features/timer/canvas/draw-timer.ts
'worklet';

import type { CanvasToken } from './canvas-palettes';
import type { DrawFrame } from '@/canvas/canvas-types';
import type { SkCanvas } from '@shopify/react-native-skia';

export type TimerView = { readonly remainingShare: number };

/** A live surface: a real-time loop redraws it every frame (realtime-game-loop owns its tests). */
export function drawTimer(canvas: SkCanvas, frame: DrawFrame<TimerView, CanvasToken>): void {
  const { width, height } = frame.layout;
  canvas.drawColor(frame.colors.color.background);
  frame.kit.stroke.setColor(frame.colors.color.ring);
  frame.kit.stroke.setStrokeWidth(Math.max(2, width * 0.04));
  const radius = Math.min(width, height) * 0.4 * frame.view.remainingShare;
  canvas.drawCircle(width / 2, height / 2, radius, frame.kit.stroke);
}
