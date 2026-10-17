// src/canvas/gestures/stick-command.ts
'worklet';

/**
 * The 16 stick directions of continuous input (games, simulations): command k (1…16) means the
 * unit vector (cos((k-1)·22.5°), sin((k-1)·22.5°)) in canvas coordinates (y points down), and 0
 * means idle. Precomputed once with Node and committed as literals: the kit never calls Math.cos
 * or Math.sin, whose results differ between JavaScript engines. A simulation that consumes the
 * commands keeps the same table in the same order.
 */
export const STICK_DIRECTIONS = [
  1, 0, 0.9238795325112867, 0.3826834323650898, 0.7071067811865476, 0.7071067811865476,
  0.3826834323650898, 0.9238795325112867, 0, 1, -0.3826834323650898, 0.9238795325112867,
  -0.7071067811865476, 0.7071067811865476, -0.9238795325112867, 0.3826834323650898, -1, 0,
  -0.9238795325112867, -0.3826834323650898, -0.7071067811865476, -0.7071067811865476,
  -0.3826834323650898, -0.9238795325112867, 0, -1, 0.3826834323650898, -0.9238795325112867,
  0.7071067811865476, -0.7071067811865476, 0.9238795325112867, -0.3826834323650898,
] as const;

/** Command of a resting stick. */
export const STICK_IDLE = 0;
/** Drags shorter than this (pt) keep the stick idle, so a resting thumb does not drift. */
export const STICK_DEAD_ZONE = 12;
const DIRECTION_COUNT = 16;

/** Drag vector → integer command: nearest direction by largest dot product (no atan2), or idle. */
export function stickCommand(dx: number, dy: number, deadZone: number = STICK_DEAD_ZONE): number {
  if (dx * dx + dy * dy < deadZone * deadZone) return STICK_IDLE;
  let best = 0;
  let bestDot = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < DIRECTION_COUNT; k += 1) {
    const dot = dx * (STICK_DIRECTIONS[k * 2] ?? 0) + dy * (STICK_DIRECTIONS[k * 2 + 1] ?? 0);
    if (dot > bestDot) {
      bestDot = dot;
      best = k;
    }
  }
  return best + 1;
}
