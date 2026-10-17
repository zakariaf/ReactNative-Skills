// src/games/arena-chase/sim/arena-chase-sim.test.ts
import { commandLog, replayCommands } from '@/core/realtime/replay-commands';

import {
  createArenaChaseSim,
  drainArenaChaseEvents,
  EVENT_HIT,
  EVENT_INPUT,
  stepArenaChaseSim,
} from './arena-chase-sim';

import type { ArenaChaseSim } from './arena-chase-sim';

const CHASERS = 20;

function fingerprint(sim: ArenaChaseSim): string {
  const header = Array.from(sim.ints.subarray(0, 3)).join(',');
  return `${Array.from(sim.body).join(',')}|${header}|${Array.from(sim.rng).join(',')}`;
}

/** Plays `ticks` ticks, grouping them into "frames" of 1–3 ticks like a real display would. */
function play(seed: number, ticks: number, commandAt: (tick: number) => number) {
  const sim = createArenaChaseSim(seed, CHASERS);
  const events: number[] = [];
  let tick = 0;
  while (tick < ticks) {
    const frameSteps = 1 + (tick % 3);
    for (let s = 0; s < frameSteps && tick < ticks; s += 1, tick += 1) {
      stepArenaChaseSim(sim, commandAt(tick));
    }
    events.push(...drainArenaChaseEvents(sim));
  }
  return { sim, events };
}

describe('arena chase simulation', () => {
  it('replays a recorded run exactly from its (tick, command) log', () => {
    const recorded = play(7, 1200, (tick) => (tick >> 5) % 17);
    const replayed = replayCommands(
      { sim: createArenaChaseSim(7, CHASERS), step: stepArenaChaseSim, ticks: 1200 },
      commandLog(recorded.events, EVENT_INPUT),
    );
    expect(fingerprint(replayed)).toBe(fingerprint(recorded.sim));
  });

  it('gives the same result however ticks are grouped into frames', () => {
    const bot = (tick: number): number => (tick * 7) % 17;
    const grouped = play(3, 900, bot).sim;
    const single = createArenaChaseSim(3, CHASERS);
    for (let tick = 0; tick < 900; tick += 1) stepArenaChaseSim(single, bot(tick));
    expect(fingerprint(single)).toBe(fingerprint(grouped));
  });

  it('reports hits as events when an idle player is caught', () => {
    const { events } = play(1, 1800, () => 0);
    const hits = events.filter((_, i) => i % 3 === 0).filter((kind) => kind === EVENT_HIT);
    expect(hits.length).toBeGreaterThan(0);
  });
});
