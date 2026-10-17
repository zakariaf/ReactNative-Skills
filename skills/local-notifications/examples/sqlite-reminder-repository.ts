// src/data/reminders/sqlite-reminder-repository.ts (example: the rows the sync reads)
// loadActiveReminders is the sync's `loadReminders`; findReminder is what a tap reads before it
// navigates: the reminder's subject (the task), which the app maps to a typed route. Every write
// that changes what should fire ends with sync.request() after the commit.
import * as v from 'valibot';

import { attempt, err, ok } from '@/core/result';

import type { Reminder, ReminderSchedule } from '@/core/reminders/reminder';
import type { Result } from '@/core/result';
import type { SqlDriver } from '@/data/sql-driver';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { ReminderLoadFailure } from '@/services/local-notifications/reminder-sync';

const ROW = v.object({
  id: v.number(),
  task_id: v.number(),
  kind: v.picklist(['at', 'once', 'daily', 'weekly']),
  at_ms: v.nullable(v.number()),
  day: v.nullable(v.string()),
  minute_of_day: v.nullable(v.number()),
  iso_weekdays: v.nullable(v.string()),
  channel_id: v.string(),
  title: v.string(),
  skip_days: v.nullable(v.string()),
});
type Row = v.InferOutput<typeof ROW>;

/** What a tapped reminder is about; the app turns it into a typed href (examples/reminders-wiring.tsx). */
export type ReminderSubject = { readonly taskId: number };

// Two kinds of bad row, both recorded and neither fatal; the row stays in the database:
// - columns of the right types but no usable schedule (a null minute, a bad day) become a schedule
//   the planner rejects ('minute-of-day', 'day', 'instant'), and the sync records it;
// - columns of the wrong types fail ROW; loadActiveReminders records their ids itself.
function scheduleOf(row: Row): ReminderSchedule {
  const minuteOfDay = row.minute_of_day ?? -1;
  switch (row.kind) {
    case 'at':
      return { kind: 'at', atMs: row.at_ms ?? Number.NaN };
    case 'once':
      return { kind: 'once', day: row.day ?? '', minuteOfDay };
    case 'daily':
      return { kind: 'daily', minuteOfDay };
    case 'weekly':
      return { kind: 'weekly', isoWeekdays: (row.iso_weekdays ?? '').split(',').map(Number), minuteOfDay };
  }
}

const toReminder = (row: Row): Reminder => ({
  id: String(row.id),
  schedule: scheduleOf(row),
  channelId: row.channel_id,
  label: row.title,
  skipDays: row.skip_days === null ? [] : row.skip_days.split(','),
});

const SELECT = `
SELECT r.id, r.task_id, r.kind, r.at_ms, r.day, r.minute_of_day, r.iso_weekdays, r.channel_id,
       t.title, (SELECT group_concat(day) FROM reminder_skip_days s WHERE s.reminder_id = r.id) AS skip_days
FROM reminders r JOIN tasks t ON t.id = r.task_id`;

const idOf = (raw: unknown): string =>
  typeof raw === 'object' && raw !== null && 'id' in raw ? String(raw.id) : '(no id)';

export function createSqliteReminderRepository(driver: SqlDriver, errorLog: ErrorLogPort) {
  return {
    /** Every active reminder of an open task: what the sync plans. Done tasks remind nobody. */
    loadActiveReminders: (): Promise<Result<readonly Reminder[], ReminderLoadFailure>> => {
      const rows = attempt(
        () => driver.all(`${SELECT} WHERE r.is_active = 1 AND t.is_done = 0`, []),
        () => ({ kind: 'storage-unavailable' }) as const,
      );
      if (!rows.ok) return Promise.resolve(rows);
      const reminders: Reminder[] = [];
      const malformed: string[] = [];
      for (const raw of rows.value) {
        const parsed = v.safeParse(ROW, raw);
        if (parsed.success) reminders.push(toReminder(parsed.output));
        else malformed.push(idOf(raw));
      }
      if (malformed.length > 0) {
        errorLog.record('storage', new Error(`reminder rows malformed: ${malformed.join(', ')}`));
      }
      return Promise.resolve(ok(reminders));
    },
    /** The subject of a tapped reminder, or null when it was deleted, deactivated or is broken. */
    findReminder: (reminderId: string): ReminderSubject | null => {
      const raw = driver.get('SELECT task_id FROM reminders WHERE id = ? AND is_active = 1', [Number(reminderId)]);
      const parsed = v.safeParse(v.object({ task_id: v.number() }), raw);
      return parsed.success ? { taskId: parsed.output.task_id } : null;
    },
    /** "Done for today": the day-based reminder stays silent until tomorrow. */
    skipToday: (reminderId: string, today: string): Result<void, ReminderLoadFailure> => {
      const written = attempt(
        () => driver.run('INSERT OR IGNORE INTO reminder_skip_days (reminder_id, day) VALUES (?, ?)', [Number(reminderId), today]),
        () => ({ kind: 'storage-unavailable' }) as const,
      );
      return written.ok ? ok(undefined) : err(written.error);
    },
  };
}
