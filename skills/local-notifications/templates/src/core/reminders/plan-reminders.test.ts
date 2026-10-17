// src/core/reminders/plan-reminders.test.ts
import fc from 'fast-check';

import { NOW_MS, TODAY, planInput, reminderRow } from '@test/reminders/reminder-rows';
import { berlin2026 } from '@test/reminders/rule-zone';

import {
  DEFAULT_MAX_PENDING,
  IOS_PENDING_LIMIT,
  REMINDER_ID_PREFIX,
  planReminders,
} from './plan-reminders';

const HOUR_MS = 3_600_000;
const idsOf = (input: Parameters<typeof planReminders>[0]): readonly string[] =>
  planReminders(input).notifications.map((notification) => notification.id);

describe('planReminders', () => {
  it('expands a daily reminder into one-shot notifications, nearest first', () => {
    const { notifications } = planReminders(planInput({ horizonDays: 3 }));

    expect(notifications.map((notification) => notification.fireAtMs)).toStrictEqual([
      Date.UTC(2026, 9, 14, 9),
      Date.UTC(2026, 9, 15, 9),
      Date.UTC(2026, 9, 16, 9),
    ]);
    expect(notifications[0]).toMatchObject({
      reminderId: 'task-42',
      channelId: 'reminders',
      title: 'Reminder',
      body: 'Water the plants',
      data: { kind: 'reminder', reminderId: 'task-42' },
    });
  });

  it('starts every identifier with the prefix the sync owns', () => {
    expect(idsOf(planInput()).every((id) => id.startsWith(REMINDER_ID_PREFIX))).toBe(true);
  });

  it('plans the same identifiers for the same input, so a repeated sync changes nothing', () => {
    expect(idsOf(planInput())).toStrictEqual(idsOf(planInput()));
  });

  it('plans a new identifier when the time, the text or the channel changes', () => {
    const [first] = idsOf(planInput({ horizonDays: 1 }));
    const moved = idsOf(
      planInput({
        horizonDays: 1,
        reminders: [reminderRow({ schedule: { kind: 'daily', minuteOfDay: 10 * 60 } })],
      }),
    );
    const renamed = idsOf(
      planInput({ horizonDays: 1, reminders: [reminderRow({ label: 'Feed the cat' })] }),
    );
    const translated = idsOf(
      planInput({ horizonDays: 1, describe: () => ({ title: 'تذكير', body: 'سقي النباتات' }) }),
    );

    expect(new Set([first, moved[0], renamed[0], translated[0]]).size).toBe(4);
  });

  it('keeps 09:00 local across a daylight saving change', () => {
    const { notifications } = planReminders(
      planInput({
        nowMs: Date.UTC(2026, 2, 27, 12),
        today: '2026-03-27',
        offsetAt: berlin2026,
        horizonDays: 3,
      }),
    );

    expect(notifications.map((notification) => notification.fireAtMs)).toStrictEqual([
      Date.UTC(2026, 2, 28, 8),
      Date.UTC(2026, 2, 29, 7),
    ]);
  });

  it('skips occurrences in the past or closer than the minimum lead', () => {
    const now = Date.UTC(2026, 9, 14, 8, 59, 58);
    const { notifications } = planReminders(planInput({ nowMs: now, horizonDays: 2 }));

    expect(notifications.map((notification) => notification.fireAtMs)).toStrictEqual([
      Date.UTC(2026, 9, 15, 9),
    ]);
  });

  it('reports an occurrence inside the lead as imminent instead of planning it', () => {
    const now = Date.UTC(2026, 9, 14, 8, 59, 58);
    const onTime = planReminders(planInput({ horizonDays: 2 }));
    const late = planReminders(planInput({ nowMs: now, horizonDays: 2 }));

    expect(late.imminentIds).toStrictEqual([onTime.notifications[0]?.id]);
    expect(onTime.imminentIds).toStrictEqual([]);
  });

  it('honours skip days, weekdays, one-off days and instants', () => {
    const reminders = [
      reminderRow({ id: 'daily', skipDays: ['2026-10-15'] }),
      reminderRow({
        id: 'weekly',
        schedule: { kind: 'weekly', isoWeekdays: [5], minuteOfDay: 600 },
      }),
      reminderRow({ id: 'once', schedule: { kind: 'once', day: '2026-10-15', minuteOfDay: 720 } }),
      reminderRow({
        id: 'once-done',
        schedule: { kind: 'once', day: '2026-10-15', minuteOfDay: 720 },
        skipDays: ['2026-10-15'],
      }),
      reminderRow({ id: 'snooze', schedule: { kind: 'at', atMs: NOW_MS + HOUR_MS / 2 } }),
    ];
    const { notifications } = planReminders(planInput({ reminders, horizonDays: 3 }));

    expect(notifications.map((notification) => notification.reminderId)).toStrictEqual([
      'snooze',
      'daily',
      'once',
      'daily',
      'weekly',
    ]);
  });

  it('keeps only the nearest occurrences, at most maxPending of them', () => {
    const reminders = Array.from({ length: 30 }, (_, index) =>
      reminderRow({ id: `task-${String(index)}`, schedule: { kind: 'daily', minuteOfDay: index } }),
    );
    const { notifications } = planReminders(planInput({ reminders }));
    const times = notifications.map((notification) => notification.fireAtMs);

    expect(notifications).toHaveLength(DEFAULT_MAX_PENDING);
    expect(times).toStrictEqual([...times].sort((a, b) => a - b));
  });

  it('refuses a maxPending above the iOS limit of 64', () => {
    expect(() => planReminders(planInput({ maxPending: IOS_PENDING_LIMIT + 1 }))).toThrow(
      RangeError,
    );
  });

  it('rejects rows it cannot use and still plans the others', () => {
    const reminders = [
      reminderRow({ id: 'bad id!' }),
      reminderRow({ id: 'other-channel', channelId: 'marketing' }),
      reminderRow({ id: 'bad-minute', schedule: { kind: 'daily', minuteOfDay: 1440 } }),
      reminderRow({ id: 'good' }),
    ];
    const result = planReminders(planInput({ reminders, horizonDays: 1 }));

    expect(result.rejected).toStrictEqual([
      { reminderId: 'bad id!', problem: 'id' },
      { reminderId: 'other-channel', problem: 'channel' },
      { reminderId: 'bad-minute', problem: 'minute-of-day' },
    ]);
    expect(result.notifications.map((notification) => notification.reminderId)).toStrictEqual([
      'good',
    ]);
  });

  it('is deterministic and bounded for any set of daily reminders', () => {
    const rowsArb = fc.uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z0-9]{1,8}$/),
        minute: fc.integer({ min: 0, max: 1439 }),
      }),
      { selector: (row) => row.id, maxLength: 12 },
    );
    fc.assert(
      fc.property(rowsArb, fc.integer({ min: 0, max: IOS_PENDING_LIMIT }), (rows, maxPending) => {
        const reminders = rows.map(({ id, minute }) =>
          reminderRow({ id, schedule: { kind: 'daily', minuteOfDay: minute } }),
        );
        const input = planInput({ reminders, maxPending, today: TODAY });
        const ids = idsOf(input);

        expect(ids).toStrictEqual(idsOf(input));
        expect(ids.length).toBeLessThanOrEqual(maxPending);
        expect(new Set(ids).size).toBe(ids.length);
      }),
    );
  });
});
