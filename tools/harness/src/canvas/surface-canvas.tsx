// src/canvas/surface-canvas.tsx
// device-only: covered by surface-canvas.test.tsx (props wiring), the surface's pixel goldens and the canvas end-to-end flow (a Skia Canvas; unit Jest has no Skia).
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { IDLE_POINTER } from './canvas-types';
import { recordPicture } from './record-picture';

import type { CanvasLayout } from './canvas-layout';
import type {
  CanvasColors,
  CanvasHighlight,
  CanvasSurface,
  PointerSample,
  DrawKit,
} from './canvas-types';
import type { SceneClock } from './use-scene-clock';
import type { SkSize } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';
import type { DerivedValue, SharedValue } from 'react-native-reanimated';

/** Touch input for an interactive surface (built by canvas-gestures-and-hit-testing). */
export type CanvasInput = {
  readonly gesture: ComponentProps<typeof GestureDetector>['gesture'];
  /** Written by the gesture worklets; draw() reads it as frame.fx.pointer. */
  readonly pointer: SharedValue<PointerSample>;
};

export type SurfaceCanvasProps<TState, TView, TToken extends string> = {
  readonly surface: CanvasSurface<TState, TView, TToken>;
  readonly clock: Pick<SceneClock<TView>, 'scene' | 'now'>;
  /** The canvas size, written by <Canvas onSize>, and the layout derived from it (useSurfacePlayer). */
  readonly size: SharedValue<SkSize>;
  readonly layout: DerivedValue<CanvasLayout>;
  readonly colors: CanvasColors<TToken>;
  readonly kit: DrawKit;
  /** The screen's selection and hinted targets; changes on taps and hints, never per frame. */
  readonly highlight: CanvasHighlight;
  /** Already translated with t() from surface.describe(view). */
  readonly accessibilityLabel: string;
  readonly onDrawError: (message: string) => void;
  /** Leave out for a display-only surface. */
  readonly input?: CanvasInput;
  /**
   * Default true: draw() paints every pixel first (canvas.drawColor of the background), so the canvas
   * may be opaque. Android then backs it with a SurfaceView (cheapest; transparent pixels are not
   * blended with the views behind it, and a parent's rounded clip and alpha do not apply). Pass false
   * for a canvas that must show what lies behind it (a chart on a card with rounded corners): Android
   * then uses a TextureView, which composites like a view but costs more. Declare that surface
   * "opaque": false in contracts/canvas-surfaces.json.
   */
  readonly isOpaque?: boolean;
};

/** One Skia Canvas with one Picture, re-recorded on the UI thread from the surface's draw(). */
export function SurfaceCanvas<TState, TView, TToken extends string>(
  props: SurfaceCanvasProps<TState, TView, TToken>,
): React.JSX.Element {
  const { surface, clock, layout, colors, kit, highlight, onDrawError } = props;
  // One recorder per canvas, reused every frame; created in render, never at import time.
  const [recorder] = useState(() => Skia.PictureRecorder());
  const pointer = props.input?.pointer ?? null;
  const reportDrawError = (message: string): void => {
    'worklet';
    scheduleOnRN(onDrawError, message);
  };
  const picture = useDerivedValue(() =>
    recordPicture(recorder, {
      scene: clock.scene.get(),
      now: clock.now.get(),
      layout: layout.get(),
      pointer: pointer === null ? IDLE_POINTER : pointer.get(),
      highlight,
      colors,
      kit,
      draw: surface.draw,
      onError: reportDrawError,
    }),
  );
  const canvas = (
    <Canvas
      style={styles.canvas}
      onSize={props.size}
      opaque={props.isOpaque ?? true}
      accessible
      accessibilityRole="image"
      accessibilityLabel={props.accessibilityLabel}
    >
      <Picture picture={picture} />
    </Canvas>
  );
  if (props.input === undefined) return canvas;
  return <GestureDetector gesture={props.input.gesture}>{canvas}</GestureDetector>;
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
