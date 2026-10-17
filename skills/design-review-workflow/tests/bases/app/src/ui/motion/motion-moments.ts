// src/ui/motion/motion-moments.ts
export const MOTION_MOMENTS = {
  press: { kind: 'feedback', trigger: 'A finger lands on any PressableSurface', reduced: 'fade' },
  pressRelease: { kind: 'feedback', trigger: 'The finger lifts off a PressableSurface', reduced: 'instant' },
  screenPush: { kind: 'transition', trigger: 'A stack screen is pushed or popped', reduced: 'fade' },
} as const;
