// src/services/local-notifications/reminder-sync.test.ts
import { err, ok } from '@/core/result';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFakeLocalZone } from '@/services/local-zone/fake-local-zone';
import { CHANNEL_ID, NOW_MS, TODAY, reminderRow } from '@test/reminders/reminder-rows';
import { berlin2026, newYork2026 } from '@test/reminders/rule-zone';

import { createFakeLocalNotifications } from './fake-local-notifications';
import { createReminderSync } from './reminder-sync';

import type { FakeLocalNotificationsOptions } from './fake-local-notifications';
import type { ReminderLoadFailure } from './reminder-sync';
import type { Reminder } from '@/core/reminders/reminder';
import type { Result } from '@/core/result';
import type { TFunction } from '@/i18n/create-t';

const CHANNEL = {
  id: CHANNEL_ID,
  name: 'Reminders',
  description: 'Yours',
  importance: 'high',
} as const;

/** A t() of one language: every text is the language's word, so a switch shows in every text. */
const tIn =
  (word: string): TFunction =>
  () =>
    word;

function setup(
  options: FakeLocalNotificationsOptions & {
    readonly rows?: readonly Reminder[];
    readonly load?: Result<readonly Reminder[], ReminderLoadFailure>;
  } = {},
): {
  readonly sync: ReturnType<typeof createReminderSync>;
  readonly notifications: ReturnType<typeof createFakeLocalNotifications>;
  readonly zone: ReturnType<typeof createFakeLocalZone>;
  readonly clock: ReturnType<typeof createFakeClock>;
  readonly errorLog: ReturnType<typeof createFakeErrorLog>;
  readonly setRows: (rows: readonly Reminder[]) => void;
} {
  const notifications = createFakeLocalNotifications(options);
  const zone = createFakeLocalZone();
  const errorLog = createFakeErrorLog();
  const clock = createFakeClock({ nowMs: NOW_MS, today: TODAY });
  let rows = options.rows ?? [reminderRow()];
  const sync = createReminderSync({
    notifications,
    zone,
    clock,
    errorLog,
    loadReminders: () => Promise.resolve(options.load ?? ok(rows)),
    texts: (t) => ({
      channels: [{ ...CHANNEL, name: t('reminders.channel.reminders.name') }],
      describe: ({ reminder }) => ({
        title: t('reminders.notification.title'),
        body: reminder.label,
      }),
    }),
    translateNow: () => tIn('Reminder'),
  });
  return {
    sync,
    notifications,
    zone,
    clock,
    errorLog,
    setRows: (next) => {
      rows = next;
    },
  };
}

const pendingOf = (notifications: ReturnType<typeof createFakeLocalNotifications>): string[] =>
  [...notifications.pending().keys()].sort();

describe('createReminderSync', () => {
  it('fills the pending set from the database, channels first', async () => {
    const { sync, notifications } = setup();

    const outcome = await sync.sync();

    expect(outcome).toMatchObject({ kind: 'synced', scheduled: 30, cancelled: 0, pending: 30 });
    expect(notifications.channels()).toStrictEqual([{ ...CHANNEL, name: 'Reminder' }]);
  });

  it('changes nothing when run again on the same data', async () => {
    const { sync, notifications } = setup();
    await sync.sync();
    const before = pendingOf(notifications);

    const outcome = await sync.sync();

    expect(outcome).toMatchObject({ kind: 'synced', scheduled: 0, cancelled: 0 });
    expect(pendingOf(notifications)).toStrictEqual(before);
  });

  it('replaces the pending notifications of an edited reminder and drops a deleted one', async () => {
    const { sync, notifications, setRows } = setup();
    await sync.sync();

    setRows([reminderRow({ schedule: { kind: 'daily', minuteOfDay: 600 } })]);
    const edited = await sync.sync();
    setRows([]);
    const deleted = await sync.sync();

    expect(edited).toMatchObject({ scheduled: 30, cancelled: 30 });
    expect(deleted).toMatchObject({ scheduled: 0, cancelled: 30, pending: 0 });
    expect(pendingOf(notifications)).toStrictEqual([]);
  });

  it('keeps a pending reminder that fires within the lead, unless its row is gone', async () => {
    const { sync, notifications, clock, setRows } = setup();
    await sync.sync();
    const firesAt = (atMs: number): boolean =>
      [...notifications.pending().values()].some((planned) => planned?.fireAtMs === atMs);
    // Two seconds before today's 09:00: too close to schedule again, but already in the OS.
    clock.advance(3_600_000 - 2000);

    const kept = await sync.sync();
    const isStillPending = firesAt(NOW_MS + 3_600_000);
    setRows([]);
    const deleted = await sync.sync();

    expect(kept).toMatchObject({ kind: 'synced', scheduled: 0, cancelled: 0 });
    expect(isStillPending).toBe(true);
    expect(deleted).toMatchObject({ cancelled: 30 });
    expect(pendingOf(notifications)).toStrictEqual([]);
  });

  it('leaves other features pending notifications alone', async () => {
    const { sync, notifications, setRows } = setup({ pendingIds: ['timer:tea'] });
    setRows([]);

    await sync.sync();

    expect(pendingOf(notifications)).toStrictEqual(['timer:tea']);
  });

  it('plans again in the new zone after travel and in the new language after a switch', async () => {
    const { sync, zone } = setup();
    zone.travel(berlin2026);
    await sync.sync();

    zone.travel(newYork2026);
    const travelled = await sync.sync();
    const translated = await sync.sync({ t: tIn('تذكير') });

    expect(travelled).toMatchObject({ scheduled: 30, cancelled: 29 });
    expect(translated).toMatchObject({ scheduled: 30, cancelled: 30 });
  });

  it('names the channels in the language passed last, also in runs that pass none', async () => {
    const { sync, notifications } = setup();
    await sync.sync();
    const before = notifications.channels().map(({ name }) => name);

    sync.request({ t: tIn('تذكير') });
    await sync.sync();
    const afterWrite = await sync.sync();

    expect(before).toStrictEqual(['Reminder']);
    expect(notifications.channels().map(({ name }) => name)).toStrictEqual(['تذكير']);
    expect(afterWrite).toMatchObject({ scheduled: 0, cancelled: 0 });
  });

  it('uses the t() passed to a request made while a run is in flight', async () => {
    const { sync, notifications } = setup();

    const first = sync.sync();
    const queued = sync.sync({ t: tIn('Rappel') });
    await Promise.all([first, queued]);

    expect(notifications.channels().map(({ name }) => name)).toStrictEqual(['Rappel']);
  });

  it('schedules nothing without the permission and keeps the database untouched', async () => {
    const { sync, notifications } = setup({ permission: 'denied' });

    await expect(sync.sync()).resolves.toStrictEqual({
      kind: 'not-allowed',
      permission: 'denied',
      cancelled: 0,
    });
    expect(notifications.calls()).toMatchObject({ schedule: 0, cancel: 0, channelSyncs: 1 });
  });

  it('cancels the reminders of deleted rows even while the permission is blocked', async () => {
    const { sync, notifications, setRows } = setup({ pendingIds: ['timer:tea'] });
    await sync.sync();
    notifications.setPermission('blocked');

    setRows([]);
    const outcome = await sync.sync();

    expect(outcome).toStrictEqual({ kind: 'not-allowed', permission: 'blocked', cancelled: 30 });
    expect(pendingOf(notifications)).toStrictEqual(['timer:tea']);
  });

  it('turns reminders on from a person action: channels, prompt, then a sync', async () => {
    const { sync, notifications } = setup({ permission: 'undetermined', answer: 'granted' });

    await expect(sync.enable()).resolves.toBe('granted');
    expect(notifications.calls()).toMatchObject({ prompts: 1, schedule: 1 });
    expect(notifications.pending().size).toBe(30);
  });

  it('skips the prompt once the permission is blocked', async () => {
    const { sync, notifications } = setup({ permission: 'blocked' });

    await expect(sync.enable()).resolves.toBe('blocked');
    expect(notifications.calls().prompts).toBe(0);
  });

  it('records rows it could not plan and refusals, and still schedules the rest', async () => {
    const rows = [reminderRow(), reminderRow({ id: 'bad', channelId: 'marketing' })];
    const { sync, errorLog } = setup({ rows });

    const outcome = await sync.sync();

    expect(outcome).toMatchObject({
      kind: 'synced',
      rejected: [{ reminderId: 'bad', problem: 'channel' }],
    });
    expect(errorLog.entries()).toHaveLength(1);
  });

  it('stops before touching the OS when the database or the pending read fails', async () => {
    const broken = setup({ load: err({ kind: 'storage-unavailable' }) });
    const unreadable = setup({ isPendingReadBroken: true });

    await expect(broken.sync.sync()).resolves.toStrictEqual({ kind: 'failed', step: 'load' });
    await expect(unreadable.sync.sync()).resolves.toStrictEqual({
      kind: 'failed',
      step: 'pending',
    });
    expect([
      broken.notifications.calls().schedule,
      unreadable.notifications.calls().schedule,
    ]).toStrictEqual([0, 0]);
  });

  it('runs one sync at a time: calls during a run share one follow-up run', async () => {
    const { sync, notifications } = setup();

    const outcomes = await Promise.all([sync.sync(), sync.sync(), sync.sync()]);

    expect(outcomes.map((outcome) => outcome.kind)).toStrictEqual(['synced', 'synced', 'synced']);
    expect(notifications.calls().schedule).toBe(2);
    expect(outcomes[1]).toBe(outcomes[2]);
  });

  it('starts a sync without waiting when asked from an effect or after a write', async () => {
    const { sync, notifications } = setup();

    sync.request();
    await sync.sync();

    expect(notifications.pending().size).toBe(30);
  });
});
