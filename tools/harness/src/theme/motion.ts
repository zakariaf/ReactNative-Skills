// src/theme/motion.ts
// Motion tokens as plain data, copied from design/tokens.json "motion". Components turn them into
// Reanimated calls, for example
//   withTiming(1, { duration: MOTION_MS.pressIn, easing: Easing.bezier(...EASING.decelerate) }).
// Every moment that moves also has its reduce-motion alternative (references/motion-tokens.md). No
// component writes a duration, delay or spring number itself (check-raw-values: no-raw-duration,
// no-raw-spring). The press surface's feedback tokens are PRESS in tokens.ts.

/** cubic-bezier control points (x1, y1, x2, y2). */
export const EASING = {
  standard: [0.2, 0, 0, 1],
  decelerate: [0, 0, 0, 1],
  accelerate: [0.3, 0, 1, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
} as const;

/** Durations in ms. holdToConfirm is a functional timer: it never shortens under reduce motion. */
export const MOTION_MS = {
  pressIn: 70,
  fast: 120,
  standard: 240,
  slow: 360,
  reducedFade: 120,
  holdToConfirm: 1500,
} as const;

/**
 * Springs with damping, stiffness and mass written out. A config that leaves mass out inherits
 * Reanimated's default, which is 4 in Reanimated 4.5.1 (a slow, bouncy release), and the library
 * has changed its defaults between majors before.
 */
export const SPRINGS = {
  release: { damping: 14, stiffness: 420, mass: 1 },
  sheet: { damping: 22, stiffness: 260, mass: 1 },
} as const;
