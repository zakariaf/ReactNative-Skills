// src/games/arena-chase/sim/arena-chase-sim.test.ts
import {
  createArenaChaseSim,
  drainArenaChaseEvents,
  EVENT_INPUT,
  EVENT_SPARK,
  arenaChaseOutcome,
  arenaChaseScore,
  stepArenaChaseSim,
} from './arena-chase-sim';

import type { ArenaChaseSim } from './arena-chase-sim';

type Recording = { readonly tick: number; readonly command: number };

const EAST = 1;

function fingerprint(sim: ArenaChaseSim): string {
  return `${Array.from(sim.body).join(',')}|${Array.from(sim.ints.subarray(0, 8)).join(',')}`;
}

/** Plays `ticks` ticks in frames of 1 to 3 ticks and keeps the (tick, command) log it drains. */
function play(seed: number, ticks: number, commandAt: (tick: number) => number) {
  const sim = createArenaChaseSim(seed, 34);
  const inputs: Recording[] = [];
  let tick = 0;
  while (tick < ticks) {
    for (let step = 0; step < 1 + (tick % 3) && tick < ticks; step += 1, tick += 1)
      stepArenaChaseSim(sim, commandAt(tick));
    const events = drainArenaChaseEvents(sim);
    for (let at = 0; at < events.length; at += 3) {
      if (events[at] === EVENT_INPUT)
        inputs.push({ command: events[at + 1] ?? 0, tick: events[at + 2] ?? 0 });
    }
  }
  return { sim, inputs };
}

describe('arena chase sim', () => {
  it('starts in play with the first spark within reach of a straight push', () => {
    const sim = createArenaChaseSim(1, 0);
    expect(arenaChaseOutcome(sim)).toStrictEqual({ kind: 'playing' });
    let tick = 0;
    while (arenaChaseScore(sim) === 0 && tick < 120) {
      stepArenaChaseSim(sim, EAST);
      tick += 1;
    }
    expect(arenaChaseScore(sim)).toBe(1);
    expect(drainArenaChaseEvents(sim)).toContain(EVENT_SPARK);
  });

  it('replays a recorded run exactly from its (tick, command) log', () => {
    const recorded = play(7, 1200, (tick) => (tick >> 5) % 17);
    const replay = createArenaChaseSim(7, 34);
    let command = 0;
    let next = 0;
    for (let tick = 0; tick < 1200; tick += 1) {
      if (recorded.inputs[next]?.tick === tick) {
        command = recorded.inputs[next]?.command ?? 0;
        next += 1;
      }
      stepArenaChaseSim(replay, command);
    }
    expect(fingerprint(replay)).toBe(fingerprint(recorded.sim));
  });

  it('gives the same result however ticks are grouped into frames', () => {
    const steer = (tick: number): number => (tick * 7) % 17;
    const single = createArenaChaseSim(3, 34);
    for (let tick = 0; tick < 900; tick += 1) stepArenaChaseSim(single, steer(tick));
    expect(fingerprint(play(3, 900, steer).sim)).toBe(fingerprint(single));
  });

  it('stops changing once the run is over', () => {
    const sim = createArenaChaseSim(2, 67);
    for (let tick = 0; tick < 2000; tick += 1) stepArenaChaseSim(sim, 0);
    expect(arenaChaseOutcome(sim)).toStrictEqual({
      kind: 'lost',
      reasonKey: 'arena-chase.lose.out-of-hearts',
    });
    const before = fingerprint(sim);
    stepArenaChaseSim(sim, EAST);
    expect(fingerprint(sim)).toBe(before);
  });
});
