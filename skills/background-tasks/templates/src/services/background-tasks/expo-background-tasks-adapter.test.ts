// src/services/background-tasks/expo-background-tasks-adapter.test.ts
// Drives the adapter against Jest's automocks of expo-background-task and expo-task-manager (read
// with typed requireMock); the enums come from the real module.
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import {
  createExpoBackgroundTasksAdapter,
  triggerBackgroundRunForTesting,
  watchBackgroundExpiry,
} from './expo-background-tasks-adapter';

jest.mock('expo-background-task', () => ({
  ...jest.requireActual<object>('expo-background-task'),
  getStatusAsync: jest.fn(),
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
  addExpirationListener: jest.fn(),
  triggerTaskWorkerForTestingAsync: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({ getRegisteredTasksAsync: jest.fn() }));

type Registration = {
  readonly taskName: string;
  readonly taskType: string;
  readonly options: unknown;
};
type MockedBackgroundTask = {
  readonly getStatusAsync: jest.Mock<Promise<number>>;
  readonly registerTaskAsync: jest.Mock<Promise<void>, [string, { minimumInterval?: number }]>;
  readonly unregisterTaskAsync: jest.Mock<Promise<void>, [string]>;
  readonly addExpirationListener: jest.Mock<{ remove: () => void }, [() => void]>;
  readonly triggerTaskWorkerForTestingAsync: jest.Mock<Promise<boolean>>;
};
type MockedTaskManager = {
  readonly getRegisteredTasksAsync: jest.Mock<Promise<Registration[]>>;
};

const backgroundTask = jest.requireMock<MockedBackgroundTask>('expo-background-task');
const taskManager = jest.requireMock<MockedTaskManager>('expo-task-manager');
const AVAILABLE = 2;
const RESTRICTED = 1;

function createAdapter(): {
  readonly adapter: ReturnType<typeof createExpoBackgroundTasksAdapter>;
  readonly errorLog: ReturnType<typeof createFakeErrorLog>;
} {
  const errorLog = createFakeErrorLog();
  return { adapter: createExpoBackgroundTasksAdapter({ errorLog }), errorLog };
}

describe('createExpoBackgroundTasksAdapter', () => {
  it('maps the status, and treats an unreadable status as restricted', async () => {
    const { adapter, errorLog } = createAdapter();
    backgroundTask.getStatusAsync
      .mockResolvedValueOnce(AVAILABLE)
      .mockResolvedValueOnce(RESTRICTED)
      .mockRejectedValueOnce(new Error('module missing'));

    const answers = [
      await adapter.availability(),
      await adapter.availability(),
      await adapter.availability(),
    ];

    expect(answers).toStrictEqual(['available', 'restricted', 'restricted']);
    expect(errorLog.recorded).toHaveLength(1);
  });

  it('lists only background-task registrations, with their interval', async () => {
    const { adapter } = createAdapter();
    taskManager.getRegisteredTasksAsync.mockResolvedValueOnce([
      {
        taskName: 'tasks.sync-outbox',
        taskType: 'backgroundTask',
        options: { minimumInterval: 720 },
      },
      { taskName: 'tasks.cleanup', taskType: 'expo-background-task', options: {} },
      { taskName: 'location-updates', taskType: 'location', options: { accuracy: 3 } },
    ]);

    await expect(adapter.scheduled()).resolves.toStrictEqual({
      ok: true,
      value: [
        { name: 'tasks.sync-outbox', intervalMinutes: 720 },
        { name: 'tasks.cleanup', intervalMinutes: null },
      ],
    });
  });

  it('registers with the interval spelled out', async () => {
    const { adapter } = createAdapter();
    backgroundTask.registerTaskAsync.mockResolvedValueOnce(undefined);

    await expect(adapter.register('tasks.sync-outbox', 720)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(backgroundTask.registerTaskAsync).toHaveBeenCalledWith('tasks.sync-outbox', {
      minimumInterval: 720,
    });
  });

  it('turns a rejected SDK call into a failure and records the original error', async () => {
    const { adapter, errorLog } = createAdapter();
    const notConfigured = new Error('Background tasks are not configured');
    backgroundTask.registerTaskAsync.mockRejectedValueOnce(notConfigured);
    backgroundTask.unregisterTaskAsync.mockRejectedValueOnce(new Error('gone'));
    taskManager.getRegisteredTasksAsync.mockRejectedValueOnce(new Error('unreadable'));

    const results = [
      await adapter.register('tasks.sync-outbox', 720),
      await adapter.unregister('tasks.old'),
      await adapter.scheduled(),
    ];

    expect(results).toStrictEqual([
      { ok: false, error: { kind: 'background-register-failed', name: 'tasks.sync-outbox' } },
      { ok: false, error: { kind: 'background-unregister-failed', name: 'tasks.old' } },
      { ok: false, error: { kind: 'background-schedule-unreadable' } },
    ]);
    expect(errorLog.recorded[0]?.error).toBe(notConfigured);
  });
});

describe('watchBackgroundExpiry', () => {
  it('subscribes to the iOS expiry event and hands back its subscription', () => {
    const remove = jest.fn();
    backgroundTask.addExpirationListener.mockReturnValueOnce({ remove });
    const onExpire = jest.fn();

    const subscription = watchBackgroundExpiry(onExpire);
    subscription.remove();

    expect(backgroundTask.addExpirationListener).toHaveBeenCalledWith(onExpire);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('triggerBackgroundRunForTesting', () => {
  it('asks the worker to run in a debug build', async () => {
    backgroundTask.triggerTaskWorkerForTestingAsync.mockResolvedValueOnce(true);

    await expect(triggerBackgroundRunForTesting()).resolves.toBe(true);
  });
});
