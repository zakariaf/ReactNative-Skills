// src/canvas/realtime/realtime-canvas-host.test.tsx
// no-providers: the host takes its sim, draw, colours and callbacks as props and reads no context.
// The real-time host's lifecycle without a device: Skia is the central inert mock, the loop hook is
// replaced by a recorder of start/stop calls, and the app-active hook is driven by the test.
import { render } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

import { RealtimeCanvasHost } from './realtime-canvas-host';

import type { RealtimeCanvasHostProps } from './realtime-canvas-host';
import type { DrawKit } from '@/canvas/canvas-types';

type Sim = { readonly body: Float32Array };

type FrameTime = ((dtMs: number | null) => void) | null;

const mockLoop: {
  start: jest.Mock;
  stop: jest.Mock;
  onEvents: (events: readonly number[]) => void;
  onFrameTime: FrameTime | undefined;
} = { start: jest.fn(), stop: jest.fn(), onEvents: () => undefined, onFrameTime: undefined };
const mockApp = { isActive: true };

jest.mock('./use-fixed-step-loop', () => ({
  useFixedStepLoop: (input: {
    onEvents: (events: readonly number[]) => void;
    onFrameTime: FrameTime;
  }) => {
    mockLoop.onEvents = input.onEvents;
    mockLoop.onFrameTime = input.onFrameTime;
    return { start: mockLoop.start, stop: mockLoop.stop };
  },
}));
jest.mock('@/hooks/use-is-app-active', () => ({
  useIsAppActive: () => mockApp.isActive,
}));

const SIM: Sim = { body: new Float32Array([1, 2, 3, 4]) };

function props(
  overrides: Partial<RealtimeCanvasHostProps<Sim, string>> = {},
): RealtimeCanvasHostProps<Sim, string> {
  return {
    initialSim: SIM,
    game: { step: () => undefined, drainEvents: () => [] },
    draw: () => undefined,
    colors: { set: 'dark', color: {} },
    kit: {} as DrawKit,
    makeGesture: () => Gesture.Pan(),
    accessibilityLabel: 'Arena',
    isFocused: true,
    isInterrupted: false,
    isPaused: false,
    isEnded: false,
    onEvents: jest.fn(),
    isSavePoint: (events: readonly number[]) => events[0] === 9,
    onSavePoint: jest.fn(),
    onAutoPause: jest.fn(),
    onFailure: jest.fn(),
    ...overrides,
  };
}

describe('RealtimeCanvasHost', () => {
  beforeEach(() => {
    mockApp.isActive = true;
  });

  it('starts the loop only when the surface may run', async () => {
    await render(<RealtimeCanvasHost {...props({ isInterrupted: true })} />);
    expect(mockLoop.start).not.toHaveBeenCalled();
    const shown = props();
    await render(<RealtimeCanvasHost {...shown} />);
    expect(mockLoop.start).toHaveBeenCalledTimes(1);
  });

  it('stops, saves and shows pause when the app leaves, then never resumes by itself', async () => {
    const shown = props();
    const { rerender } = await render(<RealtimeCanvasHost {...shown} />);
    mockApp.isActive = false;
    await rerender(<RealtimeCanvasHost {...shown} />);
    expect(mockLoop.stop).toHaveBeenCalledTimes(1);
    expect(shown.onSavePoint).toHaveBeenCalledWith(SIM);
    expect(shown.onAutoPause).toHaveBeenCalledTimes(1);
    mockApp.isActive = true;
    await rerender(<RealtimeCanvasHost {...shown} isPaused />);
    expect(mockLoop.start).toHaveBeenCalledTimes(1);
    await rerender(<RealtimeCanvasHost {...shown} />);
    expect(mockLoop.start).toHaveBeenCalledTimes(2);
  });

  it('stops without a save point or pause when the run ends', async () => {
    const shown = props();
    const { rerender } = await render(<RealtimeCanvasHost {...shown} />);
    await rerender(<RealtimeCanvasHost {...shown} isEnded />);
    expect(mockLoop.stop).toHaveBeenCalledTimes(1);
    expect(shown.onSavePoint).not.toHaveBeenCalled();
    expect(shown.onAutoPause).not.toHaveBeenCalled();
  });

  it('saves at a save-point batch before handing the events on', async () => {
    const shown = props();
    await render(<RealtimeCanvasHost {...shown} />);
    mockLoop.onEvents([1, 5, 0]);
    expect(shown.onSavePoint).not.toHaveBeenCalled();
    mockLoop.onEvents([9, 1, 240]);
    expect(shown.onSavePoint).toHaveBeenCalledWith(SIM);
    expect(shown.onEvents).toHaveBeenLastCalledWith([9, 1, 240]);
    const saved = (shown.onSavePoint as jest.Mock).mock.invocationCallOrder[0] ?? 0;
    const handed = (shown.onEvents as jest.Mock).mock.invocationCallOrder[1] ?? 0;
    expect(saved).toBeLessThan(handed);
  });

  it('hands the frame-time recorder to the loop, and null in store builds', async () => {
    await render(<RealtimeCanvasHost {...props()} />);
    expect(mockLoop.onFrameTime).toBeNull();
    const recorder = jest.fn();
    await render(<RealtimeCanvasHost {...props({ onFrameTime: recorder })} />);
    expect(mockLoop.onFrameTime).toBe(recorder);
  });
});
