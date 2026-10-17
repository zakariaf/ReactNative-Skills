// src/services/background-tasks/fake-background-tasks.test.ts
import { createFakeBackgroundTasks } from './fake-background-tasks';

describe('createFakeBackgroundTasks', () => {
  it('is available with an empty schedule by default', async () => {
    const tasks = createFakeBackgroundTasks();

    await expect(tasks.availability()).resolves.toBe('available');
    await expect(tasks.scheduled()).resolves.toStrictEqual({ ok: true, value: [] });
  });

  it('keeps the first registration of a name, like the SDK, and records every call', async () => {
    const tasks = createFakeBackgroundTasks({
      scheduled: [{ name: 'tasks.old', intervalMinutes: 60 }],
    });

    await tasks.register('tasks.sync', 720);
    await tasks.register('tasks.sync', 30);
    await tasks.unregister('tasks.old');

    expect(tasks.schedule()).toStrictEqual([{ name: 'tasks.sync', intervalMinutes: 720 }]);
    expect(tasks.calls()).toStrictEqual([
      'register tasks.sync 720',
      'register tasks.sync 30',
      'unregister tasks.old',
    ]);
  });

  it('fails register for the names it was told to and reports the restricted status', async () => {
    const tasks = createFakeBackgroundTasks({
      availability: 'restricted',
      failingNames: ['tasks.a'],
    });

    await expect(tasks.availability()).resolves.toBe('restricted');
    await expect(tasks.register('tasks.a', 720)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'background-register-failed', name: 'tasks.a' },
    });
    expect(tasks.schedule()).toStrictEqual([]);
  });
});
