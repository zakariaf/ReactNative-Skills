// src/features/timer/sim/timer-sim.ts (a live surface's loop lives beside its canvas folder)
'worklet';

export function remainingShare(elapsedMs: number, totalMs: number): number {
  return totalMs <= 0 ? 0 : Math.max(0, 1 - elapsedMs / totalMs);
}
