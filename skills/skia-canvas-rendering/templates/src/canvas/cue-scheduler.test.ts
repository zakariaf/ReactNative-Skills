// src/canvas/cue-scheduler.test.ts
import { createCueScheduler } from './cue-scheduler';

import type { CueAudio, CueHaptics } from './cue-scheduler';
import type { HapticCue, Track } from './timeline/track';

type AudioCall =
  | { readonly kind: 'play'; readonly soundId: string; readonly delayMs: number }
  | { readonly kind: 'cancel-pending' };

/** Records what the scheduler asks of the ports. */
function fakePorts(): {
  audio: CueAudio;
  haptics: CueHaptics;
  calls: AudioCall[];
  played: HapticCue[];
} {
  const calls: AudioCall[] = [];
  const played: HapticCue[] = [];
  const audio: CueAudio = {
    play: (soundId, delayMs = 0) => calls.push({ kind: 'play', soundId, delayMs }),
    cancelPending: () => calls.push({ kind: 'cancel-pending' }),
  };
  const haptics: CueHaptics = { play: (cue) => played.push(cue) };
  return { audio, haptics, calls, played };
}

const cued = (startMs: number): Track => ({
  channel: 'glow',
  entityId: 1,
  startMs,
  durationMs: 100,
  easing: 'linear',
  from: [0],
  to: [1],
  cue: { sound: 'complete', haptic: 'medium' },
});

describe('cue scheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('schedules sounds on the audio clock and haptics at the track start', () => {
    const ports = fakePorts();
    createCueScheduler(ports.audio, ports.haptics).schedule([cued(0), cued(120)]);
    expect(ports.calls).toStrictEqual([
      { kind: 'play', soundId: 'complete', delayMs: 0 },
      { kind: 'play', soundId: 'complete', delayMs: 120 },
    ]);
    expect(ports.played).toStrictEqual(['medium']);
    jest.advanceTimersByTime(120);
    expect(ports.played).toStrictEqual(['medium', 'medium']);
  });

  it('drops pending cues on cancel (fast-forward, pause, leaving the screen)', () => {
    const ports = fakePorts();
    const cues = createCueScheduler(ports.audio, ports.haptics);
    cues.schedule([cued(200)]);
    cues.cancel();
    jest.advanceTimersByTime(500);
    expect(ports.played).toStrictEqual([]);
    expect(ports.calls.at(-1)).toStrictEqual({ kind: 'cancel-pending' });
  });
});
