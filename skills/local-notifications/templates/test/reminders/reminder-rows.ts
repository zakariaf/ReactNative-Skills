// test/reminders/reminder-rows.ts
// Reminder rows for tests, shaped the way the repository returns them, and the plan input a test
// starts from: a fixed instant and day, the reminders channel, and a describe() that builds the
// text from the label (the app passes a t() call instead).
import type { PlanInput } from '@/core/reminders/plan-reminders';
import type { Reminder } from '@/core/reminders/reminder';

/** 2026-10-14 08:00 UTC, a Wednesday: the "now" of every reminder test unless it says otherwise. */
export const NOW_MS = Date.UTC(2026, 9, 14, 8);
export const TODAY = '2026-10-14';
export const CHANNEL_ID = 'reminders';

/** A daily 09:00 reminder for task 42, with any field replaced. */
export function reminderRow(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'task-42',
    schedule: { kind: 'daily', minuteOfDay: 9 * 60 },
    channelId: CHANNEL_ID,
    label: 'Water the plants',
    skipDays: [],
    ...overrides,
  };
}

/** A plan input in UTC at NOW_MS, with any field replaced. */
export function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    reminders: [reminderRow()],
    nowMs: NOW_MS,
    today: TODAY,
    offsetAt: () => 0,
    channelIds: [CHANNEL_ID],
    describe: ({ reminder }) => ({ title: 'Reminder', body: reminder.label }),
    ...overrides,
  };
}
