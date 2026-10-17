// src/services/background-tasks/reconcile-background-tasks.test.ts
import { createFakeBackgroundTasks } from './fake-background-tasks';
import { reconcileBackgroundTasks } from './reconcile-background-tasks';

const JOBS = ['tasks.sync-outbox', 'tasks.purge-done'];

describe('reconcileBackgroundTasks', () => {
  it('registers every defined job with the one interval', async () => {
    const port = createFakeBackgroundTasks();

    const report = await reconcileBackgroundTasks({
      port,
      jobNames: JOBS,
      intervalMinutes: 720,
      isEnabled: true,
    });

    expect(report).toStrictEqual({
      ok: true,
      value: {
        availability: 'available',
        scheduled: ['tasks.purge-done', 'tasks.sync-outbox'],
        removed: [],
      },
    });
    expect(port.schedule()).toStrictEqual([
      { name: 'tasks.purge-done', intervalMinutes: 720 },
      { name: 'tasks.sync-outbox', intervalMinutes: 720 },
    ]);
  });

  it('changes nothing when the schedule already matches', async () => {
    const port = createFakeBackgroundTasks({
      scheduled: JOBS.map((name) => ({ name, intervalMinutes: 720 })),
    });

    await reconcileBackgroundTasks({ port, jobNames: JOBS, intervalMinutes: 720, isEnabled: true });

    expect(port.calls()).toStrictEqual([]);
  });

  it('removes a job an older version scheduled and re-registers a changed interval', async () => {
    const port = createFakeBackgroundTasks({
      scheduled: [
        { name: 'tasks.sync', intervalMinutes: 720 },
        { name: 'tasks.sync-outbox', intervalMinutes: 60 },
      ],
    });

    const report = await reconcileBackgroundTasks({
      port,
      jobNames: ['tasks.sync-outbox'],
      intervalMinutes: 720,
      isEnabled: true,
    });

    expect(port.calls()).toStrictEqual([
      'unregister tasks.sync',
      'unregister tasks.sync-outbox',
      'register tasks.sync-outbox 720',
    ]);
    expect(report.ok && report.value.removed).toStrictEqual(['tasks.sync']);
  });

  it('removes every job when the user turned background work off', async () => {
    const port = createFakeBackgroundTasks({
      scheduled: JOBS.map((name) => ({ name, intervalMinutes: 720 })),
    });

    const report = await reconcileBackgroundTasks({
      port,
      jobNames: JOBS,
      intervalMinutes: 720,
      isEnabled: false,
    });

    expect(port.schedule()).toStrictEqual([]);
    expect(report.ok && report.value).toStrictEqual({
      availability: 'available',
      scheduled: [],
      removed: ['tasks.purge-done', 'tasks.sync-outbox'],
    });
  });

  it('registers nothing on a restricted device and says so', async () => {
    const port = createFakeBackgroundTasks({ availability: 'restricted' });

    const report = await reconcileBackgroundTasks({
      port,
      jobNames: JOBS,
      intervalMinutes: 720,
      isEnabled: true,
    });

    expect(report).toStrictEqual({
      ok: true,
      value: { availability: 'restricted', scheduled: [], removed: [] },
    });
    expect(port.calls()).toStrictEqual([]);
  });

  it('stops at the first failure and returns it', async () => {
    const port = createFakeBackgroundTasks({ failingNames: ['tasks.sync-outbox'] });

    const report = await reconcileBackgroundTasks({
      port,
      jobNames: JOBS,
      intervalMinutes: 720,
      isEnabled: true,
    });

    expect(report).toStrictEqual({
      ok: false,
      error: { kind: 'background-register-failed', name: 'tasks.sync-outbox' },
    });
  });

  it.each([14, 0, 90.5])(
    'rejects the interval %d as a programming error',
    async (intervalMinutes) => {
      const port = createFakeBackgroundTasks();

      await expect(
        reconcileBackgroundTasks({ port, jobNames: JOBS, intervalMinutes, isEnabled: true }),
      ).rejects.toThrow('>= 15');
    },
  );
});
