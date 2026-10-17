// scripts/build/build-steps.ts: tooling source is scanned (only the root build/ output is skipped).
export const buildSteps = (variant: string): readonly string[] => ['prebuild', variant];
