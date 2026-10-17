// src/ui/motion/motion-moments.ts
// The moment catalog: every moment of the app that moves, declared once. A moment names what
// starts it, the motion tokens it spends (by token name, from src/theme/motion.ts), what it shows
// when motion is reduced, and, for shared primitives that cannot import this file, the files that
// animate it. Code ties itself to a moment by reading MOTION_MOMENTS.<id> (through moment-config.ts)
// or by being listed in `files`; check-motion fails an animating file that belongs to no moment, a
// moment nothing animates, and a celebration over its budget. Plain data with type-only imports, so
// the checker loads it with Node alone.
import type { EASING, MOTION_MS, SPRINGS } from '@/theme/motion';

/**
 * feedback: answers a touch (press, release, a rejected input). state: a value changed in place
 * (a checkbox fills). transition: something enters, leaves or a screen changes. attention: a loop
 * that asks to be noticed (syncing). celebration: a bounded flourish after a result. functional: a
 * timer the person acts on (hold to confirm), which reduce motion never shortens.
 */
export const MOMENT_KINDS = [
  'feedback',
  'state',
  'transition',
  'attention',
  'celebration',
  'functional',
] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

/**
 * What a moment shows when motion is reduced. instant: jumps to its end state (what the root
 * MotionConfig does by itself). fade: a short opacity change replaces the movement (REDUCED_FADE).
 * static: never starts, the rest or end state shows. none: removed (the result is already on
 * screen). unchanged: plays as designed (functional timers only).
 */
export const REDUCED_ALTERNATIVES = ['instant', 'fade', 'static', 'none', 'unchanged'] as const;
export type ReducedAlternative = (typeof REDUCED_ALTERNATIVES)[number];

/** The reduced alternatives each kind may declare. */
export const REDUCED_BY_KIND = {
  feedback: ['instant', 'fade', 'none'],
  state: ['instant', 'fade'],
  transition: ['fade', 'instant', 'none'],
  attention: ['static', 'none'],
  celebration: ['static', 'fade', 'none'],
  functional: ['unchanged'],
} as const satisfies Readonly<Record<MomentKind, readonly ReducedAlternative[]>>;

export type DurationToken = keyof typeof MOTION_MS;
/** A curve from EASING, or 'linear' for functional timers and loops that must not ease. */
export type EasingToken = keyof typeof EASING | 'linear';
export type SpringToken = keyof typeof SPRINGS;

/** A timing animation: duration and curve, an optional start delay and per-item stagger. */
export type TimedTiming = {
  readonly duration: DurationToken;
  readonly easing: EasingToken;
  readonly delay?: DurationToken;
  readonly stagger?: DurationToken;
};
/** A spring animation: a complete spring token (damping, stiffness and mass written out). */
export type SprungTiming = { readonly spring: SpringToken; readonly delay?: DurationToken };
/** A native navigator transition: the platform times it, useScreenAnimation() picks it. */
export type NavigatorTiming = { readonly navigator: 'stack' };
export type MomentTiming = TimedTiming | SprungTiming | NavigatorTiming;

export type MotionMoment = {
  readonly kind: MomentKind;
  /** What starts it, in words a reviewer can find in the running app. */
  readonly trigger: string;
  readonly timing: MomentTiming;
  readonly reduced: ReducedAlternative;
  /** Celebrations only: how many pieces move, at most CELEBRATION_LIMITS.maxPieces. */
  readonly pieces?: number;
  /** Feedback only: a finite repeat count (a shake). Loops are attention moments. */
  readonly repeat?: number;
  /**
   * The event the commit plays: a key of the feature's cue table (`'task-completed'`), not a sound
   * id; never fired from an animation callback.
   */
  readonly cue?: string;
  /** Files that animate this moment without importing the catalog (shared primitives). */
  readonly files?: readonly string[];
};

/** A celebration ends within maxMs of its trigger and moves at most maxPieces pieces. */
export const CELEBRATION_LIMITS = { maxMs: 1600, maxPieces: 24 } as const;

export const MOTION_MOMENTS = {
  press: {
    kind: 'feedback',
    trigger: 'A finger lands on any PressableSurface',
    timing: { duration: 'pressIn', easing: 'decelerate' },
    reduced: 'fade',
    files: ['src/ui/pressable-surface.tsx'],
  },
  pressRelease: {
    kind: 'feedback',
    trigger: 'The finger lifts off a PressableSurface',
    timing: { spring: 'release' },
    reduced: 'instant',
    files: ['src/ui/pressable-surface.tsx'],
  },
  screenPush: {
    kind: 'transition',
    trigger: 'A stack screen is pushed or popped',
    timing: { navigator: 'stack' },
    reduced: 'fade',
    files: ['src/features/root-navigator/app-stack.tsx', 'src/app/(app)/_layout.tsx'],
  },
} as const satisfies Readonly<Record<string, MotionMoment>>;

export type MomentId = keyof typeof MOTION_MOMENTS;
