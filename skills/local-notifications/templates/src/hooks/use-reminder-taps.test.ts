// src/hooks/use-reminder-taps.test.ts
// no-providers: the hook takes the port and the open function as arguments.
import { act, renderHook } from '@testing-library/react-native';

import { reminderTapData } from '@/core/reminders/reminder-tap';
import { createFakeLocalNotifications } from '@/services/local-notifications/fake-local-notifications';

import { useReminderTaps } from './use-reminder-taps';

const tapOf = (
  id: string,
  data: unknown,
  action = 'open',
): { id: string; action: string; data: unknown } => ({
  id,
  action,
  data,
});

describe('useReminderTaps', () => {
  it('opens the reminder whose tap launched the app, once, and clears it', async () => {
    const notifications = createFakeLocalNotifications();
    notifications.tap(tapOf('n-1', reminderTapData('task-42')));
    const opened: string[] = [];

    const { rerender } = await renderHook(() => {
      useReminderTaps(notifications, (id) => opened.push(id));
    });
    await rerender({});

    expect(opened).toStrictEqual(['task-42']);
    expect(notifications.lastTap()).toBeNull();
  });

  it('clears the launch tap again when the listener delivers it a second time', async () => {
    const notifications = createFakeLocalNotifications();
    const launch = tapOf('n-1', reminderTapData('task-42'));
    notifications.tap(launch);
    const opened: string[] = [];
    await renderHook(() => {
      useReminderTaps(notifications, (id) => opened.push(id));
    });

    // The native emitter stores every response it emits as the last one.
    await act(() => {
      notifications.tap(launch);
    });

    expect(opened).toStrictEqual(['task-42']);
    expect(notifications.lastTap()).toBeNull();
  });

  it('leaves the last tap alone when it is not a reminder', async () => {
    const notifications = createFakeLocalNotifications();
    notifications.tap(tapOf('push-1', { kind: 'task-assigned', taskId: '9' }));
    await renderHook(() => {
      useReminderTaps(notifications, () => undefined);
    });

    expect(notifications.lastTap()).not.toBeNull();
  });

  it('opens later taps, ignores repeats, action buttons and taps that are not reminders', async () => {
    const notifications = createFakeLocalNotifications();
    const opened: string[] = [];
    const { unmount } = await renderHook(() => {
      useReminderTaps(notifications, (id) => opened.push(id));
    });

    await act(() => {
      notifications.tap(tapOf('n-2', reminderTapData('task-7')));
      notifications.tap(tapOf('n-2', reminderTapData('task-7')));
      notifications.tap(tapOf('n-3', reminderTapData('task-8'), 'snooze'));
      notifications.tap(tapOf('push-1', { kind: 'task-assigned', taskId: '9' }));
    });
    await unmount();
    notifications.tap(tapOf('n-4', reminderTapData('task-10')));

    expect(opened).toStrictEqual(['task-7']);
  });
});
