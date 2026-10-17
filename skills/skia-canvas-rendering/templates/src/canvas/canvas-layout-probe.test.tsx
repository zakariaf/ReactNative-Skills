// src/canvas/canvas-layout-probe.test.tsx
// The probe writes its texts with AppText, which reads the theme and the font scale, so it renders
// inside the app's providers (renderWithProviders).
import { fireEvent, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { renderWithProviders } from '@test/render-with-providers';

import { EMPTY_LAYOUT } from './canvas-layout';
import { CanvasLayoutProbe, canvasLayoutText } from './canvas-layout-probe';
import { NOT_STARTED } from './scene';

import type { CanvasLayout } from './canvas-layout';
import type { MeasureOrigin } from './canvas-layout-probe';
import type { ReactNode } from 'react';

const LAYOUT: CanvasLayout = {
  width: 300,
  height: 300,
  isMirrored: false,
  regions: [{ id: 'grid', x: 6, y: 6, cell: 48, cols: 6, rows: 6 }],
};
const ORIGIN = { x: 20, y: 140 };
const measureAt: MeasureOrigin = (_view, done) => {
  done(ORIGIN);
};

type FrameScene = { readonly seq: number; readonly startAt: number; readonly endMs: number };
type ProbeProps = {
  readonly layout: CanvasLayout;
  /** The clock's scene and frame timestamp: the probe then also publishes the canvas frame. */
  readonly frame?: { readonly scene: FrameScene; readonly now: number };
};

function Probe({ layout, frame }: ProbeProps): ReactNode {
  const shared = useSharedValue(EMPTY_LAYOUT);
  const scene = useSharedValue<FrameScene>({ seq: 0, startAt: NOT_STARTED, endMs: 0 });
  const now = useSharedValue(0);
  useEffect(() => {
    shared.set(layout);
    if (frame === undefined) return;
    scene.set(frame.scene);
    now.set(frame.now);
  }, [layout, shared, frame, scene, now]);
  return (
    <CanvasLayoutProbe
      testIdPrefix="tasks"
      layout={shared}
      measureOrigin={measureAt}
      {...(frame === undefined ? {} : { clock: { scene, now } })}
    >
      <View testID="tasks.canvas" />
    </CanvasLayoutProbe>
  );
}

describe('canvasLayoutText', () => {
  it('holds the canvas origin in window points and the layout, as a flow parses it', () => {
    expect(JSON.parse(canvasLayoutText(ORIGIN, LAYOUT))).toStrictEqual({
      ...ORIGIN,
      layout: LAYOUT,
    });
  });
});

describe('CanvasLayoutProbe', () => {
  it('publishes the canvas layout once the canvas is measured and has a size', async () => {
    await renderWithProviders(<Probe layout={LAYOUT} />);
    expect(screen.queryByTestId('tasks.canvas-layout')).not.toBeOnTheScreen();

    // The canvas's layout event reaches the probe's frame, which then measures its window origin.
    await fireEvent(screen.getByTestId('tasks.canvas'), 'layout');

    expect(await screen.findByTestId('tasks.canvas-layout')).toHaveTextContent(
      canvasLayoutText(ORIGIN, LAYOUT),
    );
  });

  it('publishes the canvas frame: the seq the picture shows and whether it reached its end', async () => {
    const playing = { scene: { seq: 2, startAt: 5000, endMs: 300 }, now: 5016 };
    const view = await renderWithProviders(<Probe layout={LAYOUT} frame={playing} />);
    await fireEvent(screen.getByTestId('tasks.canvas'), 'layout');
    expect(await screen.findByTestId('tasks.canvas-frame')).toHaveTextContent(
      '{"seq":2,"settled":false}',
    );

    await view.rerender(<Probe layout={LAYOUT} frame={{ ...playing, now: 5300 }} />);

    expect(await screen.findByTestId('tasks.canvas-frame')).toHaveTextContent(
      '{"seq":2,"settled":true}',
    );
  });

  it('publishes no canvas frame without the clock', async () => {
    await renderWithProviders(<Probe layout={LAYOUT} />);
    await fireEvent(screen.getByTestId('tasks.canvas'), 'layout');
    await screen.findByTestId('tasks.canvas-layout');
    expect(screen.queryByTestId('tasks.canvas-frame')).not.toBeOnTheScreen();
  });

  it('shows nothing while the canvas has no size', async () => {
    await renderWithProviders(<Probe layout={EMPTY_LAYOUT} />);

    await fireEvent(screen.getByTestId('tasks.canvas'), 'layout');

    expect(screen.queryByTestId('tasks.canvas-layout')).not.toBeOnTheScreen();
    expect(screen.getByTestId('tasks.canvas')).toBeOnTheScreen();
  });
});
