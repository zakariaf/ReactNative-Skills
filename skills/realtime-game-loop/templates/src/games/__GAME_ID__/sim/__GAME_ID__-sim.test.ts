// src/games/__GAME_ID__/sim/__GAME_ID__-sim.test.ts
import { commandLog, replayCommands } from '@/core/realtime/replay-commands';

import {
  ARENA,
  bodyCount,
  create__GAME_PASCAL__Sim,
  drain__GAME_PASCAL__Events,
  EVENT_EDGE,
  EVENT_INPUT,
  EVENT_WAVE_END,
  MAX_ENTITIES,
  MAX_EVENTS,
  simTick,
  step__GAME_PASCAL__Sim,
  WAVE_TICKS,
} from './__GAME_ID__-sim';

import type { __GAME_PASCAL__Sim } from './__GAME_ID__-sim';

const ENTITIES = 20;

/** Every number that defines the world: bodies, header and RNG words. */
function fingerprint(sim: __GAME_PASCAL__Sim): string {
  const header = Array.from(sim.ints.subarray(0, 3)).join(',');
  return `${Array.from(sim.body).join(',')}|${header}|${Array.from(sim.rng).join(',')}`;
}

/** Plays `ticks` ticks grouped into frames of 1–3 ticks, like a real display, recording inputs. */
function play(seed: number, ticks: number, commandAt: (tick: number) => number) {
  const sim = create__GAME_PASCAL__Sim(seed, ENTITIES);
  const events: number[] = [];
  let tick = 0;
  while (tick < ticks) {
    const frameSteps = 1 + (tick % 3);
    for (let s = 0; s < frameSteps && tick < ticks; s += 1, tick += 1) {
      step__GAME_PASCAL__Sim(sim, commandAt(tick));
    }
    events.push(...drain__GAME_PASCAL__Events(sim));
  }
  return { sim, events, log: commandLog(events, EVENT_INPUT) };
}

describe('__GAME_ID__ simulation', () => {
  it('replays a recorded run exactly from its (tick, command) log', () => {
    const recorded = play(7, 1200, (tick) => (tick >> 5) % 17);
    const replayed = replayCommands(
      { sim: create__GAME_PASCAL__Sim(7, ENTITIES), step: step__GAME_PASCAL__Sim, ticks: 1200 },
      recorded.log,
    );
    expect(fingerprint(replayed)).toBe(fingerprint(recorded.sim));
  });

  it('gives the same world however ticks are grouped into frames (60 vs 120 Hz)', () => {
    const bot = (tick: number): number => (tick * 7) % 17;
    const grouped = play(3, 900, bot).sim;
    const single = create__GAME_PASCAL__Sim(3, ENTITIES);
    for (let tick = 0; tick < 900; tick += 1) step__GAME_PASCAL__Sim(single, bot(tick));
    expect(fingerprint(single)).toBe(fingerprint(grouped));
  });

  it('counts time in ticks and drains events once', () => {
    const sim = create__GAME_PASCAL__Sim(1, ENTITIES);
    step__GAME_PASCAL__Sim(sim, 5);
    expect(simTick(sim)).toBe(1);
    expect(drain__GAME_PASCAL__Events(sim).slice(0, 3)).toStrictEqual([EVENT_INPUT, 5, 0]);
    expect(drain__GAME_PASCAL__Events(sim)).toStrictEqual([]);
  });

  it('ends a wave every WAVE_TICKS ticks', () => {
    const { events } = play(2, WAVE_TICKS, () => 0);
    const waves = [];
    for (let e = 0; e < events.length; e += 3) if (events[e] === EVENT_WAVE_END) waves.push(events[e + 2]);
    expect(waves).toStrictEqual([WAVE_TICKS]);
  });

  it('keeps every body inside the arena and caps the entity count', () => {
    const sim = create__GAME_PASCAL__Sim(9, MAX_ENTITIES * 2);
    expect(bodyCount(sim)).toBe(MAX_ENTITIES);
    for (let tick = 0; tick < 600; tick += 1) step__GAME_PASCAL__Sim(sim, 1 + (tick % 16));
    for (let i = 0; i < bodyCount(sim) * 4; i += 4) {
      expect(sim.body[i]).toBeGreaterThanOrEqual(0);
      expect(sim.body[i]).toBeLessThanOrEqual(ARENA);
      expect(sim.body[i + 1]).toBeGreaterThanOrEqual(0);
      expect(sim.body[i + 1]).toBeLessThanOrEqual(ARENA);
    }
  });

  it('drops events when the queue is full instead of growing it', () => {
    const sim = create__GAME_PASCAL__Sim(4, ENTITIES);
    for (let tick = 0; tick < 400; tick += 1) step__GAME_PASCAL__Sim(sim, tick % 17);
    expect(drain__GAME_PASCAL__Events(sim).length).toBeLessThanOrEqual(MAX_EVENTS * 3);
  });

  it('keeps the input and save-point events when edge events flood a catch-up frame', () => {
    const sim = create__GAME_PASCAL__Sim(5, MAX_ENTITIES);
    // Every body bounces off an edge on every tick: far more edge events than the queue holds.
    for (let e = 1; e < bodyCount(sim); e += 1) sim.body[e * 4 + 2] = 4 * ARENA;
    for (let tick = 0; tick < WAVE_TICKS - 30; tick += 1) {
      step__GAME_PASCAL__Sim(sim, 0);
      drain__GAME_PASCAL__Events(sim);
    }
    for (let tick = WAVE_TICKS - 30; tick < WAVE_TICKS; tick += 1) step__GAME_PASCAL__Sim(sim, 9);
    const events = drain__GAME_PASCAL__Events(sim);
    const triples: string[] = [];
    for (let e = 0; e < events.length; e += 3) triples.push(events.slice(e, e + 3).join(','));
    expect(events.length).toBeLessThanOrEqual(MAX_EVENTS * 3);
    expect(triples.filter((t) => t.startsWith(`${String(EVENT_EDGE)},`)).length).toBeGreaterThan(100);
    expect(triples).toContain([EVENT_INPUT, 9, WAVE_TICKS - 30].join(','));
    expect(triples).toContain([EVENT_WAVE_END, WAVE_TICKS, WAVE_TICKS].join(','));
  });
});
