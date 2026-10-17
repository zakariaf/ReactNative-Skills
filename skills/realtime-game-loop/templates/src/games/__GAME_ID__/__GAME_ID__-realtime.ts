// src/games/__GAME_ID__/__GAME_ID__-realtime.ts
// The game's RealtimeSpec: what the real-time host steps on the UI thread, and how a run is created,
// saved and restored. The module joins it to its GameModule (game-rules-engine):
//   export const __GAME_CONST___GAME = { ...rules, realtime: __GAME_CONST___REALTIME };
// With the game kit, type the save points with SavePoint from '@/core/game/persistence'.
import {
  create__GAME_PASCAL__Sim,
  drain__GAME_PASCAL__Events,
  EVENT_WAVE_END,
  restore__GAME_PASCAL__Sim,
  snapshot__GAME_PASCAL__Sim,
  step__GAME_PASCAL__Sim,
} from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';

import type { RealtimeSpec } from '@/core/realtime/realtime-spec';
import type {
  __GAME_PASCAL__Sim,
  __GAME_PASCAL__SimState,
} from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';

/** Bodies in play at the start of a run (a tuning value). */
export const START_ENTITIES = 20;

/** The JSON state a new run starts from (the rules' create() keeps it in the game state). */
export function start__GAME_PASCAL__State(seed: number): __GAME_PASCAL__SimState {
  return snapshot__GAME_PASCAL__Sim(create__GAME_PASCAL__Sim(seed, START_ENTITIES));
}

/** True when a drained batch [kind, value, tick, …] holds an event of `kind`. */
function hasEvent(events: readonly number[], kind: number): boolean {
  for (let e = 0; e + 2 < events.length; e += 3) if (events[e] === kind) return true;
  return false;
}

export const __GAME_CONST___REALTIME: RealtimeSpec<
  __GAME_PASCAL__SimState,
  __GAME_PASCAL__Sim,
  'wave-end' | 'pause' | 'background'
> = {
  createSim: restore__GAME_PASCAL__Sim,
  step: step__GAME_PASCAL__Sim,
  drainEvents: drain__GAME_PASCAL__Events,
  snapshot: snapshot__GAME_PASCAL__Sim,
  savePoints: ['wave-end', 'pause', 'background'],
  isSavePoint: (events) => hasEvent(events, EVENT_WAVE_END),
};
