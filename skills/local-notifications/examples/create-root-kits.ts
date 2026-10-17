// src/services/create-root-kits.ts (example: app-startup-and-bootstrap's registry with reminders)
// The local notifications kit joins startup here, and no root file changes. The registry runs once
// per JS run from startApp, after the data layer opened, so the one reminder sync reads the rows of
// AppData (openDeviceData adds `reminders: createSqliteReminderRepository(driver, errorLog)`, and
// AppData gains `readonly reminders: ReminderRepository`: one connection, never opened here). The
// adapters do no I/O when created. The local adapter installs the app's one foreground handler; when
// push-notifications is adopted, pass installForegroundHandler: false (its adapter owns the handler
// and its policy covers local notifications); never edit the copied adapter. A tapped reminder reads
// its row again: a deleted task, or a notification from before an update, opens home instead of a
// dead route, and the row holds a subject (the task id), never a path (typed routes, no `as Href`).
import { createTranslateNow } from '@/i18n/translate-now';
import { createExpoLocalNotificationsAdapter } from '@/services/local-notifications/expo-local-notifications-adapter';
import { createLocalNotificationsKit } from '@/services/local-notifications/local-notifications-root-kit';
import { createReminderSync } from '@/services/local-notifications/reminder-sync';
import { reminderTexts } from '@/services/local-notifications/reminder-texts';
import { createSystemLocalZoneAdapter } from '@/services/local-zone/system-local-zone-adapter';

import type { ReminderSubject } from '@/data/reminders/sqlite-reminder-repository';
import type { AppData } from '@/data/app-data-context';
import type { Language } from '@/i18n/languages';
import type { RootKit } from '@/services/root-kits/root-kit';
import type { Services } from '@/services/services-context';
import type { Href } from 'expo-router';

export type RootKitsInput = {
  readonly services: Services;
  readonly data: AppData;
  readonly language: Language;
};

/** The screen a tapped reminder opens: its task, or home when the row is gone. */
function hrefForSubject(subject: ReminderSubject | null): Href {
  if (subject === null) return '/';
  return { pathname: '/(app)/tasks/[taskId]', params: { taskId: String(subject.taskId) } };
}

function localNotificationsKit({ services, data }: RootKitsInput): RootKit {
  // With push-notifications: createExpoLocalNotificationsAdapter({ errorLog, installForegroundHandler: false }).
  const notifications = createExpoLocalNotificationsAdapter({ errorLog: data.errorLog });
  // The one writer of the OS pending set, over the rows the app just opened. The kit's effects pass
  // the t() the app shows; translateNow serves a run that starts before they mount.
  const sync = createReminderSync({
    notifications,
    zone: createSystemLocalZoneAdapter(),
    clock: services.clock,
    errorLog: data.errorLog,
    loadReminders: data.reminders.loadActiveReminders,
    texts: reminderTexts,
    translateNow: () => createTranslateNow((error) => data.errorLog.record('i18n', error)),
  });
  return createLocalNotificationsKit({
    notifications,
    sync,
    hrefForReminder: (reminderId) => hrefForSubject(data.reminders.findReminder(reminderId)),
  });
}

/** Every optional kit, in the order their providers nest (the first outermost). */
export function createRootKits(input: RootKitsInput): readonly RootKit[] {
  return [localNotificationsKit(input)];
}
