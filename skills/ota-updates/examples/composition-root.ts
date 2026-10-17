// Example: the composition root with the two update members (architecture-and-boundaries owns
// these files; an app adds one member to Services and one line to each factory).
//
// src/services/services-context.tsx
//   export type Services = {
//     ...the existing ports
//     readonly updates: UpdatesPort;
//     readonly updateChecker: UpdateChecker;
//   };
//
// src/services/create-device-services.ts
import { createSystemClockAdapter } from '@/services/clock/system-clock-adapter';
import { createMemoryErrorLogAdapter } from '@/services/error-log/memory-error-log-adapter';
import { createUpdateChecker } from '@/services/updates/update-checker';
import { createExpoUpdatesAdapter } from '@/services/updates/expo-updates-adapter';

export function createDeviceServices() {
  const clock = createSystemClockAdapter();
  const errorLog = createMemoryErrorLogAdapter({ clock });
  const updates = createExpoUpdatesAdapter();
  return {
    clock,
    errorLog,
    updates,
    updateChecker: createUpdateChecker({ updates, clock, errorLog }),
    // With crash-reporting-and-observability wired, queued crash events are sent before the reload
    // ("Restart to update"); flush() never rejects and the checker bounds the wait:
    //   updateChecker: createUpdateChecker({
    //     updates, clock, errorLog,
    //     beforeApply: () => crashReporter.flush(),
    //   }),
  };
}

// src/services/create-test-services.ts (test code): the fake answers "nothing new" unless scripted.
//   const updates = createFakeUpdates(running, answers);
//   updateChecker: createUpdateChecker({ updates, clock, errorLog }),
