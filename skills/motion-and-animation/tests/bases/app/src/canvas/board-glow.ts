// src/canvas/board-glow.ts
// Decoy: canvas timelines belong to skia-canvas-rendering, so this endless loop and this deprecated
// API stay silent here.
import { runOnJS, withRepeat, withTiming } from 'react-native-reanimated';

export function glow(onDone: () => void): number {
  runOnJS(onDone)();
  return withRepeat(withTiming(1, { duration: 400 }), -1, true);
}
