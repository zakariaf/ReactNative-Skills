// src/canvas/use-surface-player.test.ts
// The player takes every port and value as input; the frame clock (the UI thread) is replaced by a
// recording stand-in, so this proves the wiring: present, cues, lifecycle and trace.
// no-providers: useSurfacePlayer reads no context; every port, setting and callback is an input.
import { renderHook } from '@testing-library/react-native';

import { useSurfacePlayer } from './use-surface-player';

import type { CanvasSurface } from './canvas-types';
import type { CommittedChange } from './present-change';
import type { Scene } from './scene';
import type { Track } from './timeline/track';
import type { SurfaceAudio, SurfacePlayerInput } from './use-surface-player';

type State = { readonly done: number };
type Event = { readonly kind: 'task-completed' };
type View = { readonly doneText: string };
type Input = SurfacePlayerInput<State, Event, View, 'ink'>;

const mockLog: string[] = [];
const mockApp = { isActive: true };
/** The trace sink the player handed the clock (debug builds). */
const mockClockOptions: { trace?: ((label: string, sample: object) => void) | null } = {};
/** The scene the clock was created with (the mounted change's final view). */
const mockInitial: { scene?: Scene<View> } = {};

jest.mock('./use-scene-clock', () => ({
  useSceneClock: (
    initial: Scene<View>,
    _onError: unknown,
    options: { trace: ((label: string, sample: object) => void) | null },
  ) => {
    mockClockOptions.trace = options.trace;
    mockInitial.scene ??= initial;
    return {
      scene: { get: () => initial },
      now: { get: () => 0 },
      push: (scene: Scene<View>) => {
        mockLog.push(`push ${String(scene.seq)} ${scene.view.doneText}`);
      },
      stop: () => {
        mockLog.push('stop');
      },
      resume: () => {
        mockLog.push('resume');
      },
      trace: (label: string) => {
        mockLog.push(`trace ${label}`);
      },
    };
  },
}));
jest.mock('@/hooks/use-is-app-active', () => ({
  useIsAppActive: () => mockApp.isActive,
}));

const SURFACE = {
  isMirroredInRtl: false,
  toView: (state: State) => ({ doneText: String(state.done) }),
  layout: () => ({ width: 0, height: 0, isMirrored: false, regions: [] }),
} as unknown as CanvasSurface<State, View, 'ink'>;
const COMPLETE: Track = {
  channel: 'pop',
  entityId: 1,
  startMs: 0,
  durationMs: 100,
  easing: 'linear',
  from: [0],
  to: [1],
  cue: { sound: 'complete' },
};
const AUDIO: SurfaceAudio = {
  play: (id: string) => mockLog.push(`play ${id}`),
  cancelPending: () => mockLog.push('cancel'),
  suspend: () => {
    mockLog.push('suspend');
    return Promise.resolve();
  },
  resume: () => {
    mockLog.push('audio-resume');
    return Promise.resolve();
  },
};

function input(change: CommittedChange<State, Event>, extra: Partial<Input> = {}): Input {
  return {
    surface: SURFACE,
    buildTimeline: () => [COMPLETE],
    change,
    format: { formatNumber: String },
    motion: 'full',
    isRtl: false,
    isFocused: true,
    isInterrupted: false,
    onFailure: jest.fn(),
    reportError: jest.fn(),
    audio: AUDIO,
    haptics: { play: jest.fn() },
    ...extra,
  };
}

const FIRST = { seq: 1, state: { done: 1 }, events: [] };

describe('useSurfacePlayer', () => {
  beforeEach(() => {
    mockLog.length = 0;
    mockApp.isActive = true;
    delete mockInitial.scene;
  });

  it('presents each change committed while mounted: old cues cancelled, the final view pushed, new cues played', async () => {
    const view = await renderHook((props: Input) => useSurfacePlayer(props), {
      initialProps: input(FIRST),
    });
    await view.rerender(
      input({ seq: 2, state: { done: 5 }, events: [{ kind: 'task-completed' }] }),
    );
    await view.rerender(
      input({ seq: 3, state: { done: 6 }, events: [{ kind: 'task-completed' }] }),
    );
    expect(mockLog).toStrictEqual([
      'trace runnable',
      'audio-resume',
      'resume',
      'cancel',
      'push 2 5',
      'play complete',
      'cancel',
      'push 3 6',
      'play complete',
    ]);
  });

  it('shows the change present at mount without animating it (a screen opened again replays nothing)', async () => {
    const goal = { seq: 7, state: { done: 28 }, events: [{ kind: 'task-completed' as const }] };
    const view = await renderHook((props: Input) => useSurfacePlayer(props), {
      initialProps: input(goal),
    });
    expect(mockInitial.scene?.seq).toBe(7);
    expect(mockInitial.scene?.view).toStrictEqual({ doneText: '28' });
    expect(mockInitial.scene?.tracks).toStrictEqual([]);
    await view.rerender(input({ ...goal }));
    expect(mockLog.filter((entry) => /^(push|play|cancel)/.test(entry))).toStrictEqual([]);
  });

  it('stops the clock, the cues and the audio while an overlay covers the surface', async () => {
    const view = await renderHook((props: Input) => useSurfacePlayer(props), {
      initialProps: input(FIRST),
    });
    mockLog.length = 0;
    await view.rerender(input(FIRST, { isInterrupted: true }));
    expect(mockLog).toStrictEqual(['trace runnable', 'stop', 'cancel', 'suspend']);
  });

  it('plays a silent surface without audio or haptics ports', async () => {
    const { audio, haptics, ...silent } = input(FIRST);
    const view = await renderHook((props: typeof silent) => useSurfacePlayer(props), {
      initialProps: silent,
    });
    await view.rerender({ ...silent, change: { seq: 2, state: { done: 2 }, events: [] } });
    expect(mockLog).toStrictEqual(['trace runnable', 'resume', 'push 2 2']);
  });

  it('traces the clock with the lifecycle facts only when a trace is given', async () => {
    await renderHook(() => useSurfacePlayer(input(FIRST)));
    expect(mockClockOptions.trace).toBeNull();
    const traced: unknown[] = [];
    const traceClock = (label: string, data: object): void => {
      traced.push([label, data]);
    };
    await renderHook(() => useSurfacePlayer(input(FIRST, { traceClock, isInterrupted: true })));
    mockClockOptions.trace?.('push', { seq: 1 });
    expect(traced).toStrictEqual([
      ['push', { seq: 1, isAppActive: true, isFocused: true, isInterrupted: true }],
    ]);
  });
});
