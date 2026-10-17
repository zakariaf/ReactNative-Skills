// src/ui/feedback/use-delayed-visibility.ts
import { useEffect, useState, useSyncExternalStore } from 'react';

import { createDelayedFlag, scheduleTimeout } from './delayed-flag';
import { PLACEHOLDER_TIMING } from './feedback-timing';

import type { Schedule } from './delayed-flag';
import type { PlaceholderTiming } from './feedback-timing';

/**
 * True while a loading placeholder should be on screen for work that is active: false for the
 * first showDelayMs, then true, and still true for minVisibleMs after it appeared. One flag per
 * mounted placeholder; its timer is cancelled on unmount. `schedule` is a seam for tests.
 */
export function useDelayedVisibility(
  isActive: boolean,
  timing: PlaceholderTiming = PLACEHOLDER_TIMING,
  schedule: Schedule = scheduleTimeout,
): boolean {
  const [flag] = useState(() => createDelayedFlag(timing, schedule));
  useEffect(() => {
    flag.set(isActive);
  }, [flag, isActive]);
  useEffect(
    () => () => {
      flag.cancel();
    },
    [flag],
  );
  return useSyncExternalStore(flag.subscribe, flag.isVisible, flag.isVisible);
}
