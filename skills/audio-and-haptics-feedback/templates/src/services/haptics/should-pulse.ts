// src/services/haptics/should-pulse.ts
export const MIN_HAPTIC_GAP_MS = 40;

export type HapticGate = {
  readonly isEnabled: boolean;
  readonly lastAtMs: number | null;
  readonly nowMs: number;
};

/** Pure: the preference is on, and 40 ms passed since the last pulse (bursts feel mushy). */
export function shouldPulse(gate: HapticGate): boolean {
  if (!gate.isEnabled) return false;
  if (gate.lastAtMs === null) return true;
  const gapMs = gate.nowMs - gate.lastAtMs;
  // ClockPort.nowMs is wall-clock time: a clock set backwards must not mute haptics.
  return gapMs < 0 || gapMs >= MIN_HAPTIC_GAP_MS;
}
