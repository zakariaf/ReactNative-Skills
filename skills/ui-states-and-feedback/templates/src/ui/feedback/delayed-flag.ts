// src/ui/feedback/delayed-flag.ts
// The timing rule of a loading placeholder as a tiny external store: it turns visible only after
// the show delay, and once visible it stays for the minimum time even when the work ends sooner.
// Timers go through an injected scheduler, so the rule is tested without fake timers or React.
import type { PlaceholderTiming } from './feedback-timing';

/** Runs `task` after `delayMs`; returns the cancel. */
export type Schedule = (task: () => void, delayMs: number) => () => void;

export type DelayedFlag = {
  /** Reports whether the work runs; unchanged values do nothing. */
  readonly set: (isActive: boolean) => void;
  readonly isVisible: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  /** Back to idle (an unmount, or StrictMode's remount); a later set() starts over. */
  readonly cancel: () => void;
};

/** setTimeout behind the Schedule shape. */
export const scheduleTimeout: Schedule = (task, delayMs) => {
  const id = setTimeout(task, delayMs);
  return () => {
    clearTimeout(id);
  };
};

type Signal = {
  readonly isVisible: () => boolean;
  /** Stores the new visibility; listeners hear only real changes. */
  readonly publish: (isNowVisible: boolean) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

function createSignal(): Signal {
  let isVisible = false;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => isVisible,
    publish: (isNowVisible) => {
      if (isNowVisible === isVisible) return;
      isVisible = isNowVisible;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** At most one pending timer: starting a new one cancels the old one. */
function createTimerSlot(schedule: Schedule): {
  readonly start: (task: () => void, delayMs: number) => void;
  readonly stop: () => void;
} {
  let cancelTimer: (() => void) | null = null;
  const stop = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };
  return {
    start: (task, delayMs) => {
      stop();
      cancelTimer = schedule(() => {
        cancelTimer = null;
        task();
      }, delayMs);
    },
    stop,
  };
}

/** A placeholder flag following `timing`; hidden until the work has run for showDelayMs. */
export function createDelayedFlag(timing: PlaceholderTiming, schedule: Schedule): DelayedFlag {
  const signal = createSignal();
  const timer = createTimerSlot(schedule);
  let isActive = false;
  /** Visible, and the minimum time has not passed yet. */
  let isHeld = false;
  const release = (): void => {
    isHeld = false;
    if (!isActive) signal.publish(false);
  };
  const show = (): void => {
    isHeld = true;
    signal.publish(true);
    timer.start(release, timing.minVisibleMs);
  };
  return {
    set: (isNowActive) => {
      if (isNowActive === isActive) return;
      isActive = isNowActive;
      if (signal.isVisible()) {
        // Visible: a stop hides at once unless the minimum time still holds it.
        if (!isNowActive && !isHeld) signal.publish(false);
        return;
      }
      if (isNowActive) timer.start(show, timing.showDelayMs);
      else timer.stop();
    },
    isVisible: signal.isVisible,
    subscribe: signal.subscribe,
    cancel: () => {
      // A visible placeholder hides at the next set(false) without waiting for the hold it lost.
      timer.stop();
      isActive = false;
      isHeld = false;
    },
  };
}
