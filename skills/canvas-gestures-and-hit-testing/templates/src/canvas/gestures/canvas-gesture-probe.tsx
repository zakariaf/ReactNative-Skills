// src/canvas/gestures/canvas-gesture-probe.tsx
// Test host: a plain View wired to useCanvasGestures. Skia's native module does not load in unit
// Jest, and input needs no picture: the gesture test drives this probe instead of the canvas.
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';

import { useCanvasGestures } from './use-canvas-gestures';

import type { CanvasIntent } from './canvas-intent';
import type { PanMode } from './pan-intent';
import type { CanvasLayout, CanvasTarget } from '@/canvas/canvas-layout';

export type CanvasGestureProbeProps = {
  readonly layout: CanvasLayout;
  readonly panMode: PanMode;
  readonly dragLiftPt?: number;
  readonly onIntent: (intent: CanvasIntent) => void;
  readonly onHover?: (target: CanvasTarget | null) => void;
  readonly onMiss?: () => void;
};

export function CanvasGestureProbe(props: CanvasGestureProbeProps): React.JSX.Element {
  const layout = useSharedValue(props.layout);
  const { gesture } = useCanvasGestures(layout, {
    panMode: props.panMode,
    dragLiftPt: props.dragLiftPt ?? 0,
    onIntent: props.onIntent,
    ...(props.onHover === undefined ? {} : { onHover: props.onHover }),
    ...(props.onMiss === undefined ? {} : { onMiss: props.onMiss }),
  });
  return (
    <GestureDetector gesture={gesture}>
      <View testID="canvas.probe-surface" />
    </GestureDetector>
  );
}
