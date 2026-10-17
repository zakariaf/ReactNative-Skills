# Wiring a native module's port into the app

The shape of the three edits that make `TimeChangePort` (templates/src/services/time-change/)
reachable, and of a model hook that uses it. The composition-root files belong to
architecture-and-boundaries; these are the lines this port adds to them, nothing else.

## 1. `src/services/services-context.tsx`: one member

```ts
import type { TimeChangePort } from '@/services/time-change/time-change-port';

export type Services = {
  readonly clock: ClockPort;
  readonly directionGuard: DirectionGuardPort;
  readonly errorLog: ErrorLogPort;
  /** Time zone, clock and day changes from the local module modules/time-change. */
  readonly timeChange: TimeChangePort;
};
```

## 2. `src/services/create-device-services.ts`: the one call that binds the module

```ts
import { createNativeTimeChangeAdapter } from '@/services/time-change/native-time-change-adapter';

export function createDeviceServices(): Services {
  const clock = createSystemClockAdapter();
  return {
    clock,
    directionGuard: createKvDirectionGuardAdapter(),
    errorLog: createMemoryErrorLogAdapter({ clock }),
    // Binds 'TimeChange' here, once, when the root layout's useState initializer runs.
    timeChange: createNativeTimeChangeAdapter(),
  };
}
```

## 3. `src/services/create-test-services.ts`: the stand-in

```ts
timeChange: given.timeChange ?? missingPort('timeChange'),
```

## 4. A model hook that refreshes "today" when the device's time moves

```ts
// src/features/tasks/use-today-key.ts (shape)
import { useEffect, useState } from 'react';

import { useServices } from '@/services/services-context';

/** Re-reads today's key when the time zone, the clock or the calendar day changes. */
export function useTodayKey(): string {
  const { clock, timeChange } = useServices();
  const [today, setToday] = useState(() => clock.today());
  useEffect(() => {
    // The port returns its unsubscribe; returning it releases the native listener on unmount,
    // and the module's OnStopObserving then removes the OS observer (iOS) or receiver (Android).
    return timeChange.subscribe(() => {
      setToday(clock.today());
    });
  }, [clock, timeChange]);
  return today;
}
```

The test renders the hook with `createFakeTimeChange()` through the render helper's services,
calls `fake.emit({ reason: 'time-zone', timeZoneId: 'Asia/Tokyo' })`, and asserts the new key and
`fake.listenerCount()` back at 0 after unmount (unit-and-component-tests owns the render helper).
