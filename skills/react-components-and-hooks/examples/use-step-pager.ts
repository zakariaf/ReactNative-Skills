// Example (shape only, never copied into the app): a hook with local state and derived values.
// One job, one returned object with named fields, local state for what only this screen needs,
// everything else derived during render. No effect: changing the step happens in the handlers that
// cause it.
import { useState } from 'react';

export type StepPager = {
  /** 1-based, for "Step 2 of 4". */
  readonly step: number;
  readonly total: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly handleNext: () => void;
  readonly handlePrevious: () => void;
};

export function useStepPager(total: number): StepPager {
  const [index, setIndex] = useState(0);
  // Derived, not stored: a shorter step list (a returning user skips two) never leaves it out of range.
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  // Functional updates: two taps before a re-render still move two steps.
  const handleNext = (): void => {
    setIndex((current) => Math.min(current + 1, total - 1));
  };
  const handlePrevious = (): void => {
    setIndex((current) => Math.max(Math.min(current, total - 1) - 1, 0));
  };
  return {
    step: safeIndex + 1,
    total,
    isFirst: safeIndex === 0,
    isLast: safeIndex >= total - 1,
    handleNext,
    handlePrevious,
  };
}
