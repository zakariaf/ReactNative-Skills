// src/services/create-root-kits.ts
// The root-kit registry (app-startup-and-bootstrap) with the local notifications kit registered:
// the kit mounts useReminderSync and useReminderTaps beside the root Stack (examples/create-root-kits.ts).
import { createExpoLocalNotificationsAdapter } from '@/services/local-notifications/expo-local-notifications-adapter';
import { createLocalNotificationsKit } from '@/services/local-notifications/local-notifications-root-kit';
import { createReminderSync } from '@/services/local-notifications/reminder-sync';

export function createRootKits({ data, services }) {
  const notifications = createExpoLocalNotificationsAdapter({ errorLog: data.errorLog });
  const sync = createReminderSync({ notifications, zone: services.localZone, clock: services.clock, errorLog: data.errorLog });
  return [createLocalNotificationsKit({ notifications, sync, hrefForReminder: () => '/' })];
}
