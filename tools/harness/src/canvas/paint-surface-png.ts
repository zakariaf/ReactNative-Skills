// src/canvas/paint-surface-png.ts
// device-only: covered by the surface pixel goldens (test/goldens/canvas/*.golden.test.ts, the Jest golden project).
// Offscreen render of the SAME draw() and layout() the device runs. Used by the golden tests (Jest,
// CanvasKit) and by headless Node scripts (store art, previews). Takes the Skia API as a parameter.
import { EMPTY_HIGHLIGHT, IDLE_POINTER } from './canvas-types';
import { sampleTimeline } from './timeline/sample';

import type { CanvasLayout } from './canvas-layout';
import type {
  CanvasColors,
  CanvasHighlight,
  DrawFrame,
  LayoutInput,
  PointerSample,
  DrawKit,
  SkiaApi,
} from './canvas-types';
import type { Track } from './timeline/track';
import type { SkCanvas } from '@shopify/react-native-skia';

export type PngRequest<TView, TToken extends string> = {
  readonly draw: (canvas: SkCanvas, frame: DrawFrame<TView, TToken>) => void;
  readonly layout: (input: LayoutInput<TView>) => CanvasLayout;
  readonly view: TView;
  readonly tracks: readonly Track[];
  readonly elapsedMs: number;
  readonly colors: CanvasColors<TToken>;
  readonly kit: DrawKit;
  readonly width: number;
  readonly height: number;
  readonly isMirrored: boolean;
  /** A finger on the surface (drag preview, hover); IDLE_POINTER when left out. */
  readonly pointer?: PointerSample;
  /** The screen's selection and hinted targets; EMPTY_HIGHLIGHT when left out. */
  readonly highlight?: CanvasHighlight;
};

export function paintSurfacePng<TView, TToken extends string>(
  skia: SkiaApi,
  request: PngRequest<TView, TToken>,
): Uint8Array {
  const surface = skia.Surface.Make(request.width, request.height);
  if (surface === null) throw new Error('Offscreen surface unavailable');
  const { width, height, view, isMirrored } = request;
  request.draw(surface.getCanvas(), {
    view,
    fx: {
      ...sampleTimeline(request.tracks, request.elapsedMs),
      pointer: request.pointer ?? IDLE_POINTER,
    },
    highlight: request.highlight ?? EMPTY_HIGHLIGHT,
    colors: request.colors,
    layout: request.layout({ width, height, view, isMirrored }),
    kit: request.kit,
  });
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes();
}
