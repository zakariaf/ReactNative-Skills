// src/games/arena-chase/sim/arena-sim.ts (stand-in): the sim only emits events.
'worklet';

export function stepArena(state: { caught: number }): readonly string[] {
  state.caught += 1;
  return ['player-caught'];
}
