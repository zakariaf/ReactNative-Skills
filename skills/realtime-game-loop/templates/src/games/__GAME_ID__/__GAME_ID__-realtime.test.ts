// src/games/__GAME_ID__/__GAME_ID__-realtime.test.ts
import { EVENT_EDGE, EVENT_WAVE_END } from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';

import { __GAME_CONST___REALTIME, start__GAME_PASCAL__State } from './__GAME_ID__-realtime';

const spec = __GAME_CONST___REALTIME;

describe('__GAME_ID__ realtime spec', () => {
  it('survives a snapshot round trip: snapshot(createSim(snapshot(sim))) equals snapshot(sim)', () => {
    const sim = spec.createSim(start__GAME_PASCAL__State(11));
    for (let tick = 0; tick < 500; tick += 1) spec.step(sim, 1 + (tick % 16));
    spec.drainEvents(sim);
    const saved = spec.snapshot(sim);
    expect(spec.snapshot(spec.createSim(saved))).toStrictEqual(saved);
    expect(JSON.parse(JSON.stringify(saved))).toStrictEqual(saved);
  });

  it('continues a restored run exactly where the saved one left off', () => {
    const original = spec.createSim(start__GAME_PASCAL__State(5));
    for (let tick = 0; tick < 300; tick += 1) spec.step(original, tick % 17);
    spec.drainEvents(original);
    const restored = spec.createSim(spec.snapshot(original));
    for (let tick = 300; tick < 600; tick += 1) {
      spec.step(original, tick % 17);
      spec.step(restored, tick % 17);
    }
    expect(spec.snapshot(restored)).toStrictEqual(spec.snapshot(original));
  });

  it('marks only a wave-end batch as a save point', () => {
    expect(spec.isSavePoint([EVENT_EDGE, 3, 10, EVENT_WAVE_END, 1800, 1800])).toBe(true);
    expect(spec.isSavePoint([EVENT_EDGE, 3, 10])).toBe(false);
    expect(spec.savePoints).toContain('wave-end');
  });
});
