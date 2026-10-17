// src/features/onboarding/use-step-pager.ts: state for what only this screen needs, the rest derived.
import { useState } from 'react';

export type StepPager = {
  readonly step: number;
  readonly isLast: boolean;
  readonly handleNext: () => void;
};

export function useStepPager(total: number): StepPager {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const handleNext = (): void => {
    setIndex((current) => Math.min(current + 1, total - 1));
  };
  return { step: safeIndex + 1, isLast: safeIndex >= total - 1, handleNext };
}
