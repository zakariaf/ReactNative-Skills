// src/ui/motion/motion-moments.ts
// The Tasks app's moment catalog (the self-test's full app; the shipped template declares only the
// moments every app starts with).
import type { EASING, MOTION_MS, SPRINGS } from '@/theme/motion';

export const MOMENT_KINDS = ['feedback', 'state', 'transition', 'attention', 'celebration', 'functional'] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
export const REDUCED_ALTERNATIVES = ['instant', 'fade', 'static', 'none', 'unchanged'] as const;
export type ReducedAlternative = (typeof REDUCED_ALTERNATIVES)[number];
export type DurationToken = keyof typeof MOTION_MS;
export type EasingToken = keyof typeof EASING | 'linear';
export type SpringToken = keyof typeof SPRINGS;
export type MomentTiming =
  | { readonly duration: DurationToken; readonly easing: EasingToken; readonly delay?: DurationToken; readonly stagger?: DurationToken }
  | { readonly spring: SpringToken; readonly delay?: DurationToken }
  | { readonly navigator: 'stack' };
export type MotionMoment = {
  readonly kind: MomentKind;
  readonly trigger: string;
  readonly timing: MomentTiming;
  readonly reduced: ReducedAlternative;
  readonly pieces?: number;
  readonly repeat?: number;
  readonly cue?: string;
  readonly files?: readonly string[];
};

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
    files: ['src/app/_layout.tsx'],
  },
  taskCheck: {
    kind: 'state',
    trigger: 'A task is marked done or open again',
    timing: { duration: 'fast', easing: 'standard' },
    reduced: 'instant',
    cue: 'task-completed',
  },
  taskRowEnter: {
    kind: 'transition',
    trigger: 'A new task appears in the list',
    timing: { duration: 'standard', easing: 'decelerate' },
    reduced: 'fade',
  },
  taskRowExit: {
    kind: 'transition',
    trigger: 'A task is deleted from the list',
    timing: { duration: 'fast', easing: 'accelerate' },
    reduced: 'fade',
  },
  sheetSettle: {
    kind: 'transition',
    trigger: 'The task sheet is let go after a drag',
    timing: { spring: 'sheet' },
    reduced: 'instant',
  },
  syncPulse: {
    kind: 'attention',
    trigger: 'A list is syncing',
    timing: { duration: 'slow', easing: 'standard' },
    reduced: 'static',
  },
  listCleared: {
    kind: 'celebration',
    trigger: 'The last open task of a list is marked done',
    timing: { duration: 'slow', easing: 'decelerate', delay: 'fast', stagger: 'pressIn' },
    reduced: 'none',
    pieces: 12,
    cue: 'list-cleared',
  },
  holdToDelete: {
    kind: 'functional',
    trigger: 'The delete key of a list is held down',
    timing: { duration: 'holdToConfirm', easing: 'linear' },
    reduced: 'unchanged',
  },
  dueChipTint: {
    kind: 'state',
    trigger: 'A task becomes overdue',
    timing: { duration: 'fast', easing: 'standard' },
    reduced: 'instant',
  },
  titleRejected: {
    kind: 'feedback',
    trigger: 'A task is saved with an empty title',
    timing: { duration: 'pressIn', easing: 'standard' },
    reduced: 'none',
    repeat: 4,
  },
  progressFill: {
    kind: 'state',
    trigger: 'The share of done tasks changes',
    timing: { duration: 'standard', easing: 'decelerate' },
    reduced: 'instant',
  },
} as const satisfies Readonly<Record<string, MotionMoment>>;

export type MomentId = keyof typeof MOTION_MOMENTS;
