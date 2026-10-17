// src/canvas/canvas-layout-probe.tsx
// End-to-end builds only (development and preview variants with the probe switched on; production
// never renders it). A Skia canvas has no accessibility children, so a Maestro flow cannot find a
// cell: the probe publishes the surface's geometry as one small text, `<prefix>.canvas-layout` =
// JSON.stringify({ x, y, layout }), where x and y are the canvas's top-left corner in window points
// and layout is the current CanvasLayout (regions in canvas points, unmirrored, plus isMirrored).
// A flow reads it with copyTextFrom and taps x + region.x + (col + 0.5) * region.cell (mirrored:
// x + layout.width - region.x - (col + 0.5) * region.cell).
// Given the clock's scene and now, it also publishes `<prefix>.canvas-frame` =
// {"seq":<n>,"settled":<b>}: the seq of the scene the picture shows and whether the picture was
// recorded at that scene's end (read on the UI thread from the values the picture is recorded
// from). A flow waits for settled true after a change; a clock that stopped early keeps it false.
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/ui/app-text';

import { sceneFrameOf, sceneFrameText } from './scene-clock-state';

import type { CanvasLayout } from './canvas-layout';
import type { Scene } from './scene';
import type { SceneFrame } from './scene-clock-state';
import type { ReactNode } from 'react';
import type { HostInstance } from 'react-native';

export type CanvasOrigin = { readonly x: number; readonly y: number };
export type MeasureOrigin = (view: HostInstance, done: (origin: CanvasOrigin) => void) => void;

export type CanvasLayoutProbeProps = {
  /** testID prefix: the screen's id, e.g. 'tasks' gives tasks.canvas-layout. */
  readonly testIdPrefix: string;
  /** The canvas's layout (useSurfacePlayer derives it from the canvas size). */
  readonly layout: { readonly get: () => CanvasLayout };
  /** The canvas, drawn exactly as without the probe. */
  readonly children: ReactNode;
  /** How the frame's window position is read; Jest passes a stand-in (no native views there). */
  readonly measureOrigin?: MeasureOrigin;
  /** The clock's scene and now: also publish <prefix>.canvas-frame. */
  readonly clock?: {
    readonly scene: { readonly get: () => Pick<Scene<unknown>, 'seq' | 'startAt' | 'endMs'> };
    readonly now: { readonly get: () => number };
  };
};

const NO_SCENE = { seq: -1, startAt: 0, endMs: 0 };

/** <prefix>.canvas-frame: changes when the seq or settled changes, never per frame. */
function useSceneFrame(clock: CanvasLayoutProbeProps['clock']): SceneFrame | null {
  const [frame, setFrame] = useState<SceneFrame | null>(null);
  const isOn = clock !== undefined;
  useAnimatedReaction(
    () =>
      clock === undefined
        ? sceneFrameOf(NO_SCENE, 0)
        : sceneFrameOf(clock.scene.get(), clock.now.get()),
    (next, previous) => {
      if (!isOn || (previous?.seq === next.seq && previous.settled === next.settled)) return;
      scheduleOnRN(setFrame, next);
    },
  );
  return frame;
}

const measureInWindow: MeasureOrigin = (view, done) => {
  view.measureInWindow((x, y) => {
    done({ x, y });
  });
};

/** The text a flow parses. */
export function canvasLayoutText(origin: CanvasOrigin, layout: CanvasLayout): string {
  return JSON.stringify({ x: origin.x, y: origin.y, layout });
}

export function CanvasLayoutProbe(props: CanvasLayoutProbeProps): ReactNode {
  const { layout, children, testIdPrefix, measureOrigin = measureInWindow } = props;
  const sceneFrame = useSceneFrame(props.clock);
  const frame = useRef<HostInstance>(null);
  const [origin, setOrigin] = useState<CanvasOrigin | null>(null);
  const [current, setCurrent] = useState<CanvasLayout | null>(null);
  // The layout changes only when the canvas size or the view changes, never per frame.
  useAnimatedReaction(
    () => layout.get(),
    (next) => {
      scheduleOnRN(setCurrent, next);
    },
  );
  const handleLayout = (): void => {
    if (frame.current !== null) measureOrigin(frame.current, setOrigin);
  };
  return (
    <View ref={frame} style={styles.frame} onLayout={handleLayout}>
      {children}
      {/* No text before the canvas has a size: a flow must never read the empty layout. */}
      {origin !== null && current !== null && current.width > 0 ? (
        <View style={styles.probe} pointerEvents="none">
          <AppText testID={`${testIdPrefix}.canvas-layout`}>
            {canvasLayoutText(origin, current)}
          </AppText>
          {sceneFrame === null ? null : (
            <AppText testID={`${testIdPrefix}.canvas-frame`}>{sceneFrameText(sceneFrame)}</AppText>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden' },
  probe: { position: 'absolute', insetBlockStart: 0, insetInlineStart: 0, insetInlineEnd: 0 },
});
