// src/canvas/realtime/paint-sim-png.ts
// device-only: covered by the real-time surface's pixel golden (test/goldens/canvas/<game-id>-arena.golden.test.ts, real CanvasKit).
// Offscreen render of a real-time surface with the SAME draw() the device runs (recordSim calls it
// inside the Picture). Used by the pixel golden (Jest, CanvasKit) and by headless Node art scripts.
// Takes the Skia API as a parameter, like paintSurfacePng.
import type { SimDraw, SimFrame } from './record-sim';
import type { SkiaApi } from '@/canvas/canvas-types';

export type SimPngRequest<TSim, TToken extends string> = SimFrame<TSim, TToken> & {
  readonly draw: SimDraw<TSim, TToken>;
};

export function paintSimPng<TSim, TToken extends string>(
  skia: SkiaApi,
  request: SimPngRequest<TSim, TToken>,
): Uint8Array {
  const surface = skia.Surface.Make(request.width, request.height);
  if (surface === null) throw new Error('Offscreen surface unavailable');
  const { sim, width, height, colors, kit } = request;
  request.draw(surface.getCanvas(), { sim, width, height, colors, kit });
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes();
}
