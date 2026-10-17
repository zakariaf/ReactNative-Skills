// src/features/task-detail/use-task-reminder-model.ts (example: the "Remind me" row of a task)
// The permission is asked here, from the person's press, after the row said what reminders do;
// never at launch. The write commits first, then the sync runs: the database is the truth, the
// notification is its copy. The ask goes through permissions-and-system-prompts' gate over the one
// notification permission (services.permissions.access.notifications is the local port, or
// push-notifications' port when push is adopted, bound in the composition root): it shows the
// explain, Android rationale or Settings sheet, respects a refusal, and runs onAllowed once
// notifications are allowed; enable() then syncs the channels and every row without prompting.
// In an app without that skill, call reminderSync.enable() from the press directly: it prompts by
// itself and resolves 'blocked' when only the Settings app can help (offer Linking.openSettings()).
// contracts/permissions.json lists `notifications` with askedFrom = this file and a sibling test.
import { useAppData } from '@/data/app-data-context';
import { usePermissionGate } from '@/hooks/use-permission-gate';
import { useReminderSyncService } from '@/services/local-notifications/reminder-sync-context';
import { useServices } from '@/services/services-context';

export function useTaskReminderModel(taskId: number) {
  const { permissions, errorLog } = useServices();
  const { reminders } = useAppData();
  const reminderSync = useReminderSyncService();
  const onError = (error: unknown): void => {
    errorLog.record('service', error);
  };
  const gate = usePermissionGate({
    access: permissions.access.notifications,
    openSettings: permissions.openSettings,
    shouldExplainFirst: false,
    onError,
  });

  const remindDailyAt = (minuteOfDay: number): void => {
    const saved = reminders.saveDaily(taskId, minuteOfDay);
    if (!saved.ok) return;
    // The row stays even when the person refuses: the feature is off, not lost, and the next
    // foreground sync schedules it once notifications are on.
    gate.requestAccess(() => {
      reminderSync.enable().then(undefined, onError);
    });
  };

  const removeReminder = (reminderId: string): void => {
    const removed = reminders.deactivate(reminderId);
    if (removed.ok) reminderSync.request();
  };

  return {
    remindDailyAt,
    removeReminder,
    sheet: gate.sheet,
    isNotificationsOff: gate.state === 'blocked',
    onContinue: gate.confirm,
    onDismiss: gate.dismiss,
    onOpenSettings: gate.openSettings,
  };
}
