// src/canvas/surface-host.test.tsx
// The canvas, the probe and the frame clock are recording stand-ins: this proves what the host
// hands them (the player's own wiring is proven in use-surface-player.test.ts).
// no-providers: SurfaceHost reads no context; every port, value and translated label is a prop.
import { render } from '@testing-library/react-native';

import { EMPTY_HIGHLIGHT } from './canvas-types';
import { SurfaceHost } from './surface-host';

import type { CanvasColors, CanvasHighlight, CanvasSurface, DrawKit } from './canvas-types';
import type { SurfaceHostProps } from './surface-host';
import type { ReactNode } from 'react';

type View = { readonly doneText: string };
type Props = SurfaceHostProps<number, never, View, 'ink'>;

const mockCanvasProps: {
  highlight?: CanvasHighlight;
  accessibilityLabel?: string;
  isOpaque?: boolean;
}[] = [];
const mockProbes: string[] = [];

jest.mock('./surface-canvas', () => {
  const recordProps = (props: { highlight: CanvasHighlight; accessibilityLabel: string }): null => {
    mockCanvasProps.push(props);
    return null;
  };
  return { SurfaceCanvas: recordProps };
});
jest.mock('./canvas-layout-probe', () => {
  const recordProbe = (props: { testIdPrefix: string; children: ReactNode }): ReactNode => {
    mockProbes.push(props.testIdPrefix);
    return props.children;
  };
  return { CanvasLayoutProbe: recordProbe };
});
jest.mock('./use-scene-clock', () => ({
  useSceneClock: () => ({
    scene: { get: () => null },
    now: { get: () => 0 },
    push: jest.fn(),
    stop: jest.fn(),
    resume: jest.fn(),
    trace: jest.fn(),
  }),
}));

const SURFACE = {
  isMirroredInRtl: false,
  toView: (state: number) => ({ doneText: String(state) }),
} as unknown as CanvasSurface<number, View, 'ink'>;

function props(extra: Partial<Props> = {}): Props {
  return {
    surface: SURFACE,
    buildTimeline: () => [],
    change: { seq: 1, state: 3, events: [] },
    format: { formatNumber: String },
    motion: 'full',
    isRtl: false,
    isFocused: true,
    isInterrupted: false,
    onFailure: jest.fn(),
    reportError: jest.fn(),
    colors: {} as CanvasColors<'ink'>,
    kit: {} as DrawKit,
    highlight: EMPTY_HIGHLIGHT,
    accessibilityLabel: '3 of 28 days done',
    ...extra,
  };
}

describe('SurfaceHost', () => {
  beforeEach(() => {
    mockCanvasProps.length = 0;
    mockProbes.length = 0;
  });

  it('passes the screen highlight and the translated label to the canvas', async () => {
    const highlight = { selected: { regionId: 'grid', col: 2, row: 0 }, hinted: [] };
    await render(<SurfaceHost {...props({ highlight })} />);
    expect(mockCanvasProps.at(-1)?.highlight).toBe(highlight);
    expect(mockCanvasProps.at(-1)?.accessibilityLabel).toBe('3 of 28 days done');
    expect(mockCanvasProps.at(-1)?.isOpaque).toBe(true);
    expect(mockProbes).toStrictEqual([]);
  });

  it('passes isOpaque={false} through for a canvas that shows what lies behind it', async () => {
    await render(<SurfaceHost {...props({ isOpaque: false })} />);
    expect(mockCanvasProps.at(-1)?.isOpaque).toBe(false);
  });

  it('wraps the canvas in the layout probe only when asked', async () => {
    await render(<SurfaceHost {...props({ probe: { testIdPrefix: 'tasks' } })} />);
    expect(mockProbes.at(-1)).toBe('tasks');
  });
});
