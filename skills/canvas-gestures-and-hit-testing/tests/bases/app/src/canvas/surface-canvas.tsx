// src/canvas/surface-canvas.tsx
// Stand-in for skia-canvas-rendering's SurfaceCanvas: the canvas kit wraps the canvas in the
// gesture layer's detector, and nothing else sits inside it.
import { Canvas, Picture } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';

import type { ComponentProps } from 'react';

export type CanvasInput = { readonly gesture: ComponentProps<typeof GestureDetector>['gesture'] };

export type SurfaceCanvasProps = {
  readonly picture: unknown;
  readonly accessibilityLabel: string;
  readonly input?: CanvasInput;
};

export function SurfaceCanvas(props: SurfaceCanvasProps): React.JSX.Element {
  const canvas = (
    <Canvas accessible accessibilityRole="image" accessibilityLabel={props.accessibilityLabel}>
      <Picture picture={props.picture} />
    </Canvas>
  );
  if (props.input === undefined) return canvas;
  return <GestureDetector gesture={props.input.gesture}>{canvas}</GestureDetector>;
}
