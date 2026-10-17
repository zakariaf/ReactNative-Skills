// src/services/local-notifications/local-notifications-root-kit.tsx
// Local reminders as a root kit (app-startup-and-bootstrap's slots): one entry in
// src/services/create-root-kits.ts plugs them into startup, and no root file changes. The registry
// creates the notification and zone adapters (no I/O; the local adapter installs the app's one
// foreground handler unless push-notifications owns it) and the one reminder sync over the reminder
// rows of AppData. The kit hands them to the slots: provide (ReminderSyncProvider around the root
// Stack, for the models that write rows) and effects (beside the Stack, after the splash release and
// inside the navigator: the sync on mount, on every return to the foreground and on a language
// change, with the t() the app shows; and the reminder taps, launch tap included, each opening the
// typed route of its row's subject).
import { useRouter } from 'expo-router';

import { useReminderSync } from '@/hooks/use-reminder-sync';
import { useReminderTaps } from '@/hooks/use-reminder-taps';
import { useT } from '@/i18n/t-context';

import { ReminderSyncProvider } from './reminder-sync-context';

import type { LocalNotificationsPort } from './local-notifications-port';
import type { ReminderSync } from './reminder-sync';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Href } from 'expo-router';

export type LocalNotificationsKitInput = {
  readonly notifications: LocalNotificationsPort;
  /** The one reminder sync (createReminderSync over the reminder repository of AppData). */
  readonly sync: ReminderSync;
  /**
   * The typed screen a tapped reminder opens: it reads the row again and maps its subject (the task)
   * to a typed href, or home when the row is gone. Never a path stored in the row.
   */
  readonly hrefForReminder: (reminderId: string) => Href;
};

/** Renders nothing: keeps the OS pending set in line with the rows and routes reminder taps. */
function LocalNotificationsEffects({
  notifications,
  sync,
  hrefForReminder,
}: LocalNotificationsKitInput): null {
  const t = useT();
  const router = useRouter();
  useReminderSync(sync, t);
  useReminderTaps(notifications, (reminderId) => {
    router.navigate(hrefForReminder(reminderId));
  });
  return null;
}

/** The local notifications kit: register it once in createRootKits. */
export function createLocalNotificationsKit(input: LocalNotificationsKitInput): RootKit {
  return {
    name: 'local-notifications',
    provide: (children) => (
      <ReminderSyncProvider sync={input.sync}>{children}</ReminderSyncProvider>
    ),
    effects: (
      <LocalNotificationsEffects
        notifications={input.notifications}
        sync={input.sync}
        hrefForReminder={input.hrefForReminder}
      />
    ),
  };
}
