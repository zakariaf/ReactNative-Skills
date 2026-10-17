// src/services/game-host/play-clock.test.ts
import { MAX_PLAY_DELTA_MS, createPlayClock } from './play-clock';

function clockAt(start: number): {
  readonly now: () => number;
  readonly set: (ms: number) => void;
} {
  let current = start;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
  };
}

describe('createPlayClock', () => {
  it('counts the time since the last lap only while playing', () => {
    const time = clockAt(1000);
    const clock = createPlayClock(time.now);
    time.set(4000);

    expect(clock.lap(true)).toBe(3000);

    time.set(9000);

    expect(clock.lap(false)).toBe(0);
  });

  it('clamps a jump forward and ignores a clock set back', () => {
    const time = clockAt(0);
    const clock = createPlayClock(time.now);
    time.set(3_600_000);

    expect(clock.lap(true)).toBe(MAX_PLAY_DELTA_MS);

    time.set(1000);

    expect(clock.lap(true)).toBe(0);
  });
});
