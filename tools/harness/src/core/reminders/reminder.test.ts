// src/core/reminders/reminder.test.ts
import { reminderRow } from '@test/reminders/reminder-rows';

import { MAX_LABEL_LENGTH, isMinuteOfDay, isReminderId, reminderProblem } from './reminder';

describe('isMinuteOfDay', () => {
  it('accepts whole minutes of a civil day only', () => {
    expect([0, 570, 1439].every(isMinuteOfDay)).toBe(true);
    expect([-1, 1440, 9.5, Number.NaN].some(isMinuteOfDay)).toBe(false);
  });
});

describe('isReminderId', () => {
  it('accepts short ids of letters, digits, _ and -', () => {
    expect(['42', 'task-42', 'list_7'].every(isReminderId)).toBe(true);
    expect(['', 'a/b', 'x'.repeat(65), 'task 42'].some(isReminderId)).toBe(false);
  });
});

describe('reminderProblem', () => {
  it('accepts a valid row of every schedule kind', () => {
    const rows = [
      reminderRow(),
      reminderRow({ schedule: { kind: 'at', atMs: 1_800_000_000_000 } }),
      reminderRow({ schedule: { kind: 'once', day: '2026-10-15', minuteOfDay: 0 } }),
      reminderRow({ schedule: { kind: 'weekly', isoWeekdays: [1, 7], minuteOfDay: 1439 } }),
    ];

    expect(rows.map(reminderProblem)).toStrictEqual([null, null, null, null]);
  });

  it('names the first problem of a row', () => {
    expect(
      [
        reminderRow({ id: '' }),
        reminderRow({ channelId: '' }),
        reminderRow({ label: 'x'.repeat(MAX_LABEL_LENGTH + 1) }),
        reminderRow({ schedule: { kind: 'daily', minuteOfDay: 1440 } }),
        reminderRow({ schedule: { kind: 'once', day: '2026-02-30', minuteOfDay: 0 } }),
        reminderRow({ schedule: { kind: 'weekly', isoWeekdays: [], minuteOfDay: 0 } }),
        reminderRow({ schedule: { kind: 'weekly', isoWeekdays: [8], minuteOfDay: 0 } }),
        reminderRow({ schedule: { kind: 'at', atMs: Number.POSITIVE_INFINITY } }),
      ].map(reminderProblem),
    ).toStrictEqual([
      'id',
      'channel',
      'label',
      'minute-of-day',
      'day',
      'weekdays',
      'weekdays',
      'instant',
    ]);
  });
});
