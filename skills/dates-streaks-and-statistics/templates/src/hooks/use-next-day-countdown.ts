// src/hooks/use-next-day-countdown.ts
// A shared cross-feature hook: the time left until the user's local midnight ("New day in 3 h 5 min",
// "Your streak ends in 40 min"), from ClockPort.msUntilNextLocalDay(), which alone knows the time
// zone and daylight saving. The snapshot is whole minutes, so React re-renders once a minute.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { splitCountdown } from '@/core/countdown/split-countdown';
import { useServices } from '@/services/services-context';

import type { Countdown } from '@/core/countdown/split-countdown';
import type { ClockPort } from '@/services/clock/clock-port';

const MINUTE_MS = 60_000;

type Subscribe = (onChange: () => void) => () => void;

// One subscribe function per clock: useSyncExternalStore resubscribes when it gets a new one.
const subscribers = new WeakMap<ClockPort, Subscribe>();

/** Milliseconds until the shown (rounded-up) minute changes: 1 .. 60,000. */
export function msUntilMinuteChange(msLeft: number): number {
  return ((Math.max(1, msLeft) - 1) % MINUTE_MS) + 1;
}

function subscribeFor(clock: ClockPort): Subscribe {
  const known = subscribers.get(clock);
  if (known !== undefined) return known;
  const subscribe: Subscribe = (onChange) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      timer = setTimeout(() => {
        onChange();
        arm();
      }, msUntilMinuteChange(clock.msUntilNextLocalDay()));
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
 * Hours and minutes until local midnight, minutes rounded up (never "0 h 0 min" before midnight).
 * The day itself turns in useToday(); never compute this from nowMs() and 86,400,000 (UTC midnight).
 */
export function useNextDayCountdown(): Countdown {
  const { clock } = useServices();
  const minutesLeft = useSyncExternalStore(subscribeFor(clock), () =>
    Math.ceil(clock.msUntilNextLocalDay() / MINUTE_MS),
  );
  return splitCountdown(minutesLeft * MINUTE_MS);
}
