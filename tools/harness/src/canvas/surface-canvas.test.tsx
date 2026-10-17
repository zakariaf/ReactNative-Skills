// src/canvas/surface-canvas.test.tsx
// The canvas takes everything as props. Skia renders as inert host elements in the unit project
// and the recorder is a recording stand-in, so this proves what reaches draw() and the screen
// reader; the pixels are proven by the surface's goldens.
// no-providers: SurfaceCanvas reads no context; the clock, colours, kit and label are props.
import { render, screen } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { EMPTY_LAYOUT } from './canvas-layout';
import { IDLE_POINTER } from './canvas-types';
import { makeScene } from './scene';
import { SurfaceCanvas } from './surface-canvas';

import type { CanvasColors, CanvasHighlight, CanvasSurface, DrawKit } from './canvas-types';
import type { RecordInput } from './record-picture';
import type { ReactNode } from 'react';

type View = { readonly cells: number };

const mockRecorded: RecordInput<View, 'ink'>[] = [];

jest.mock('./record-picture', () => ({
  recordPicture: (_recorder: unknown, input: RecordInput<View, 'ink'>) => {
    mockRecorded.push(input);
    return null;
  },
}));

const SURFACE = {
  isMirroredInRtl: false,
  layout: () => EMPTY_LAYOUT,
  draw: jest.fn(),
} as unknown as CanvasSurface<unknown, View, 'ink'>;
const HIGHLIGHT: CanvasHighlight = {
  selected: { regionId: 'grid', col: 1, row: 0 },
  hinted: [{ regionId: 'grid', col: 3, row: 2 }],
};
const LABEL = '12 of 28 days done';

/**
 * The recordings of one render, found by its scene seq: a derived value of an earlier test's tree can
 * still record after beforeEach (seen under a loaded parallel run), so `mockRecorded.at(-1)` alone is
 * not this render's frame.
 */
function recordedFor(seq: number): RecordInput<View, 'ink'> | undefined {
  return mockRecorded.filter((input) => input.scene.seq === seq).at(-1);
}

function Harness(props: {
  readonly isInteractive: boolean;
  readonly isOpaque?: boolean;
  readonly seq?: number;
}): ReactNode {
  const scene = useSharedValue(makeScene(props.seq ?? 1, { cells: 4 }, []));
  const now = useSharedValue(0);
  const size = useSharedValue({ width: 0, height: 0 });
  const layout = useDerivedValue(() => EMPTY_LAYOUT);
  const pointer = useSharedValue({ ...IDLE_POINTER, isDown: true });
  const input = props.isInteractive ? { gesture: Gesture.Tap(), pointer } : undefined;
  return (
    <SurfaceCanvas
      surface={SURFACE}
      clock={{ scene, now }}
      size={size}
      layout={layout}
      colors={{} as CanvasColors<'ink'>}
      kit={{} as DrawKit}
      highlight={HIGHLIGHT}
      accessibilityLabel={LABEL}
      onDrawError={jest.fn()}
      {...(input === undefined ? {} : { input })}
      {...(props.isOpaque === undefined ? {} : { isOpaque: props.isOpaque })}
    />
  );
}

describe('SurfaceCanvas', () => {
  beforeEach(() => {
    mockRecorded.length = 0;
  });

  it('is one accessible image named by the translated summary', async () => {
    await render(<Harness isInteractive={false} />);
    expect(screen.getByRole('image')).toHaveProp('accessibilityLabel', LABEL);
  });

  it('is opaque by default (draw paints every pixel) and translucent only when asked', async () => {
    await render(<Harness isInteractive={false} />);
    expect(screen.getByRole('image')).toHaveProp('opaque', true);
    await render(<Harness isInteractive={false} isOpaque={false} />);
    expect(screen.getByRole('image')).toHaveProp('opaque', false);
  });

  it('records the scene view with the idle pointer and the screen highlight', async () => {
    await render(<Harness isInteractive={false} seq={3} />);
    const last = recordedFor(3);
    expect(last?.scene.view).toStrictEqual({ cells: 4 });
    expect(last?.pointer).toStrictEqual(IDLE_POINTER);
    expect(last?.highlight).toBe(HIGHLIGHT);
  });

  it('records the pointer the gesture layer writes when the surface takes input', async () => {
    await render(<Harness isInteractive seq={4} />);
    expect(recordedFor(4)?.pointer.isDown).toBe(true);
    expect(screen.getByRole('image')).toHaveProp('accessibilityLabel', LABEL);
  });
});
