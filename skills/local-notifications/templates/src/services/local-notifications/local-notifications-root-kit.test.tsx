// src/services/local-notifications/local-notifications-root-kit.test.tsx
import { act, screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { AppState, View } from 'react-native';

import { reminderTapData } from '@/core/reminders/reminder-tap';
import { TContext } from '@/i18n/t-context';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { createFakeLocalNotifications } from './fake-local-notifications';
import { createLocalNotificationsKit } from './local-notifications-root-kit';
import { useReminderSyncService } from './reminder-sync-context';

import type { ReminderSync, ReminderSyncRequest } from './reminder-sync';
import type { TFunction } from '@/i18n/create-t';
import type { RootKit } from '@/services/root-kits/root-kit';

/** A reminder sync that records what it was asked; the sync's own logic has its own tests. */
function recordingSync(): ReminderSync & { readonly requests: readonly ReminderSyncRequest[] } {
  const requests: ReminderSyncRequest[] = [];
  return {
    requests,
    request: (request = {}) => {
      requests.push(request);
    },
    sync: () => Promise.resolve({ kind: 'failed', step: 'unexpected' }),
    enable: () => Promise.resolve('granted'),
  };
}

/** The shown t(): each key as its own text (the kit only passes t on). */
const echoT: TFunction = (key) => key;

/** The root layout's part that matters here: t(), then the kit's provider around its effects. */
function layoutWith(kit: RootKit): () => React.JSX.Element {
  return function KitLayout(): React.JSX.Element {
    const tree = (
      <>
        <Slot />
        {kit.effects}
      </>
    );
    return <TContext value={echoT}>{kit.provide ? kit.provide(tree) : tree}</TContext>;
  };
}

function Home(): React.JSX.Element {
  return <View testID="tasks.screen" />;
}

function TaskDetail(): React.JSX.Element {
  return <View testID="task-detail.screen" />;
}

const hrefForReminder = (reminderId: string) =>
  ({ pathname: '/tasks/[taskId]', params: { taskId: reminderId } }) as const;

describe('createLocalNotificationsKit', () => {
  // The app is in the foreground, so the syncs run on mount (useIsAppActive reads AppState).
  beforeEach(() => {
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });

  it('syncs with the shown t() once the effects mount', async () => {
    const sync = recordingSync();
    const kit = createLocalNotificationsKit({
      notifications: createFakeLocalNotifications(),
      sync,
      hrefForReminder,
    });
    await renderRouterWithProviders({ _layout: layoutWith(kit), index: Home });
    expect(sync.requests).toHaveLength(1);
    expect(typeof sync.requests[0]?.t).toBe('function');
  });

  it('opens the task of the reminder whose tap launched the app', async () => {
    const notifications = createFakeLocalNotifications();
    notifications.tap({ id: 'n-1', action: 'open', data: reminderTapData('task-42') });
    const kit = createLocalNotificationsKit({
      notifications,
      sync: recordingSync(),
      hrefForReminder,
    });
    const view = await renderRouterWithProviders({
      _layout: layoutWith(kit),
      index: Home,
      'tasks/[taskId]': TaskDetail,
    });
    expect(view.getPathname()).toBe('/tasks/task-42');
    expect(notifications.lastTap()).toBeNull();
  });

  it('leaves a tap that is not a reminder to its own handler', async () => {
    const notifications = createFakeLocalNotifications();
    const kit = createLocalNotificationsKit({
      notifications,
      sync: recordingSync(),
      hrefForReminder,
    });
    const view = await renderRouterWithProviders({
      _layout: layoutWith(kit),
      index: Home,
      'tasks/[taskId]': TaskDetail,
    });
    await act(() => {
      notifications.tap({
        id: 'p-1',
        action: 'open',
        data: { kind: 'task-assigned', taskId: '7' },
      });
    });
    expect(view.getPathname()).toBe('/');
  });

  it('hands the one sync to the models through its provider', async () => {
    const sync = recordingSync();
    const kit = createLocalNotificationsKit({
      notifications: createFakeLocalNotifications(),
      sync,
      hrefForReminder,
    });
    function Screen(): React.JSX.Element {
      const isKitSync = useReminderSyncService() === sync;
      return <View testID={isKitSync ? 'tasks.kit-sync' : 'tasks.other-sync'} />;
    }
    await renderRouterWithProviders({ _layout: layoutWith(kit), index: Screen });
    expect(screen.getByTestId('tasks.kit-sync')).toBeOnTheScreen();
  });
});
