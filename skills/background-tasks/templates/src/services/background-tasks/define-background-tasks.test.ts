// src/services/background-tasks/define-background-tasks.test.ts
// Importing the module defines the tasks (expo-task-manager keeps definitions in JS, so the real
// module answers isTaskDefined); only the native expiry subscription is replaced.
import { BACKGROUND_JOBS } from './background-jobs';

import './define-background-tasks';

jest.mock('expo-background-task', () => ({
  addExpirationListener: jest.fn(() => ({ remove: jest.fn() })),
}));

type MockedBackgroundTask = { readonly addExpirationListener: jest.Mock };
type TaskManagerModule = { readonly isTaskDefined: (name: string) => boolean };

const backgroundTask = jest.requireMock<MockedBackgroundTask>('expo-background-task');
/** Read before the first test: the Jest config clears mock calls before each test. */
const subscriptionsAtImport = backgroundTask.addExpirationListener.mock.calls.length;

describe('define-background-tasks', () => {
  it('defines every job of the build under its own name', () => {
    const taskManager = jest.requireActual<TaskManagerModule>('expo-task-manager');

    expect(BACKGROUND_JOBS.filter((job) => !taskManager.isTaskDefined(job.name))).toStrictEqual([]);
  });

  it('subscribes to the expiry signal once', () => {
    expect(subscriptionsAtImport).toBe(1);
  });
});
