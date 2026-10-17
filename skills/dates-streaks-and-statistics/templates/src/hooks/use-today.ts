// src/hooks/use-today.ts
// A shared cross-feature hook: today's local DateKey, read from ClockPort on every render and
// re-rendered when the day changes, so no screen keeps yesterday after midnight or after a resume.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useServices } from '@/services/services-context';

import type { DateKey } from '@/core/dates/date-key';
import type { ClockPort } from '@/services/clock/clock-port';

/**
 * The longest single wait. The timer is re-armed at least this often, so a phone clock or time
 * zone changed while the app stays open is noticed within a minute, and no long timer is set.
 */
export const TODAY_RECHECK_MS = 60_000;

type Subscribe = (onChange: () => void) => () => void;

// One subscribe function per clock: useSyncExternalStore resubscribes when it gets a new one.
const subscribers = new WeakMap<ClockPort, Subscribe>();

function subscribeFor(clock: ClockPort): Subscribe {
  const known = subscribers.get(clock);
  if (known !== undefined) return known;
  const subscribe: Subscribe = (onChange) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      const wait = Math.min(clock.msUntilNextLocalDay(), TODAY_RECHECK_MS);
      timer = setTimeout(() => {
        onChange();
        arm();
      }, wait);
    };
    arm();
    const subscription = AppState.addEventListener('change', onChange);
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  };
  subscribers.set(clock, subscribe);
  return subscribe;
}

/**
 * Today's local day, read on every render. Re-renders at local midnight (a timer armed from
 * msUntilNextLocalDay) and whenever the app changes state, so a screen left open overnight or
 * resumed the next morning shows the new day. Handlers still call clock.today() when they run.
 */
export function useToday(): DateKey {
  const { clock } = useServices();
  return useSyncExternalStore(subscribeFor(clock), () => clock.today());
}
