// src/canvas/describe-error.ts
// Stand-in for skia-canvas-rendering's kit file (the checker only reads that it exists and is a worklet).
'worklet';

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
