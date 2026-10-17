// src/canvas/gestures/classify-swipe.ts
'worklet';

/** Physical directions on the canvas (canvases never pixel-flip; mirroring lives in the layout). */
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/** Pan release data: translation (pt) and velocity (pt/s). */
export type SwipeInput = {
  readonly dx: number;
  readonly dy: number;
  readonly vx: number;
  readonly vy: number;
};

/** Per-surface tuning; starting values in DEFAULT_SWIPE. */
export type SwipeThresholds = {
  /** Minimum travel on the dominant axis, in points. */
  readonly minDistance: number;
  /** …or minimum release speed on the dominant axis, in points per second. */
  readonly minVelocity: number;
  /** Dominant axis must beat the other by this factor, else the swipe is ambiguous. */
  readonly dominance: number;
};

/** Starting values; tune per surface after testing on a phone, never per platform. */
export const DEFAULT_SWIPE: SwipeThresholds = { minDistance: 24, minVelocity: 600, dominance: 1.2 };

function directionOf(input: SwipeInput, isHorizontal: boolean): SwipeDirection {
  if (isHorizontal) return input.dx > 0 ? 'right' : 'left';
  return input.dy > 0 ? 'down' : 'up';
}

/** Pan release → one physical direction, or null when too short and slow, or too diagonal. */
export function classifySwipe(
  input: SwipeInput,
  thresholds: SwipeThresholds = DEFAULT_SWIPE,
): SwipeDirection | null {
  const ax = Math.abs(input.dx);
  const ay = Math.abs(input.dy);
  const isHorizontal = ax >= ay;
  const major = Math.max(ax, ay);
  const minor = Math.min(ax, ay);
  const speed = Math.abs(isHorizontal ? input.vx : input.vy);
  if (major < minor * thresholds.dominance) return null;
  if (major < thresholds.minDistance && speed < thresholds.minVelocity) return null;
  return directionOf(input, isHorizontal);
}
