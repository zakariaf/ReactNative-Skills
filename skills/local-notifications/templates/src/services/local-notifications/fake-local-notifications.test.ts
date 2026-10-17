// src/services/local-notifications/fake-local-notifications.test.ts
import { planReminders } from '@/core/reminders/plan-reminders';
import { planInput } from '@test/reminders/reminder-rows';

import { createFakeLocalNotifications } from './fake-local-notifications';

const plan = planReminders(planInput({ horizonDays: 2 })).notifications;
const TAP = { id: 'reminder:task-42:x:y', action: 'open', data: {} };

describe('createFakeLocalNotifications', () => {
  it('keeps what it schedules pending until cancelled, next to foreign identifiers', async () => {
    const notifications = createFakeLocalNotifications({ pendingIds: ['other-feature'] });

    await notifications.scheduleNotifications(plan);
    await notifications.cancelNotifications([plan[0]?.id ?? '']);

    await expect(notifications.pendingIds()).resolves.toStrictEqual({
      ok: true,
      value: ['other-feature', plan[1]?.id],
    });
    expect(notifications.calls()).toMatchObject({ schedule: 1, cancel: 1 });
  });

  it('refuses the identifiers it was told to, and can fail the pending read', async () => {
    const notifications = createFakeLocalNotifications({
      refuse: [plan[0]?.id ?? ''],
      isPendingReadBroken: true,
    });

    const failures = await notifications.scheduleNotifications(plan);

    expect(failures.map((failure) => failure.id)).toStrictEqual([plan[0]?.id]);
    await expect(notifications.pendingIds()).resolves.toMatchObject({ ok: false });
  });

  it('answers the prompt and counts it; Settings can change the permission later', async () => {
    const notifications = createFakeLocalNotifications({
      permission: 'undetermined',
      answer: 'denied',
    });

    await expect(notifications.requestPermission()).resolves.toBe('denied');
    notifications.setPermission('granted');

    await expect(notifications.permission()).resolves.toBe('granted');
    expect(notifications.calls().prompts).toBe(1);
  });

  it('records the channels it was given', async () => {
    const notifications = createFakeLocalNotifications();
    const channel = { id: 'reminders', name: 'R', description: 'D', importance: 'high' } as const;

    await notifications.syncChannels([channel]);

    expect(notifications.channels()).toStrictEqual([channel]);
  });

  it('delivers taps to listeners and keeps the last one until cleared', () => {
    const notifications = createFakeLocalNotifications();
    const seen: unknown[] = [];
    const unsubscribe = notifications.onTap((tap) => seen.push(tap));

    notifications.tap(TAP);
    unsubscribe();
    notifications.tap(TAP);
    const last = notifications.lastTap();
    notifications.clearLastTap();

    expect([seen, last, notifications.lastTap()]).toStrictEqual([[TAP], TAP, null]);
  });
});
