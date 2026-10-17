// src/canvas/gestures/stick-gesture-probe.tsx
// Test host: a plain View wired to makeStickGesture (neither Skia nor the loop is needed).
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { makeStickGesture } from './use-canvas-gestures';

import type { SharedValue } from 'react-native-reanimated';

export type StickGestureProbeProps = { readonly command: SharedValue<number> };

export function StickGestureProbe(props: StickGestureProbeProps): React.JSX.Element {
  return (
    <GestureDetector gesture={makeStickGesture(props.command)}>
      <View testID="canvas.stick-probe-surface" />
    </GestureDetector>
  );
}
