// src/hooks/use-background-registration.test.ts
// no-providers: the hook takes its port and error log as arguments and reads no context, so renderHook needs no wrapper.
// Example (Tasks app): the startup registration against the fake port. The parts most likely to
// regress are the reconcile after a setting change and what the setting row is told.
import { renderHook, waitFor } from '@testing-library/react-native';

import { BACKGROUND_INTERVAL_MINUTES } from '@/services/background-tasks/background-jobs';
import { createFakeBackgroundTasks } from '@/services/background-tasks/fake-background-tasks';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { useBackgroundRegistration } from './use-background-registration';

import type { FakeBackgroundTasksOptions } from '@/services/background-tasks/fake-background-tasks';

type Props = { readonly isEnabled: boolean };

async function renderRegistration(isEnabled: boolean, options: FakeBackgroundTasksOptions = {}) {
  const port = createFakeBackgroundTasks(options);
  // Created once, like the app's services: a new log per render would re-run the effect on every
  // render and hide a missing `isEnabled` dependency.
  const errorLog = createFakeErrorLog();
  const view = await renderHook(
    (props: Props) => useBackgroundRegistration(port, errorLog, props.isEnabled),
    { initialProps: { isEnabled } },
  );
  return { port, ...view };
}

describe('useBackgroundRegistration', () => {
  it('registers every job of the build after mount and reports the availability', async () => {
    const { port, result } = await renderRegistration(true);

    await waitFor(() => {
      expect(result.current).toBe('available');
    });
    expect(port.schedule()).toStrictEqual([
      { name: 'tasks.sync-outbox', intervalMinutes: BACKGROUND_INTERVAL_MINUTES },
    ]);
  });

  it('unregisters every job when the user turns the setting off', async () => {
    const { port, result, rerender } = await renderRegistration(true);
    await waitFor(() => {
      expect(result.current).toBe('available');
    });

    await rerender({ isEnabled: false });

    await waitFor(() => {
      expect(port.schedule()).toStrictEqual([]);
    });
    expect(port.calls()).toStrictEqual([
      `register tasks.sync-outbox ${String(BACKGROUND_INTERVAL_MINUTES)}`,
      'unregister tasks.sync-outbox',
    ]);
  });

  it('runs reconciles one after another, so a quick off-and-on ends scheduled', async () => {
    const { port, result, rerender } = await renderRegistration(true);
    await waitFor(() => {
      expect(result.current).toBe('available');
    });

    await rerender({ isEnabled: false });
    await rerender({ isEnabled: true });

    await waitFor(() => {
      expect(port.calls().at(-1)).toBe(
        `register tasks.sync-outbox ${String(BACKGROUND_INTERVAL_MINUTES)}`,
      );
    });
    expect(port.schedule()).toStrictEqual([
      { name: 'tasks.sync-outbox', intervalMinutes: BACKGROUND_INTERVAL_MINUTES },
    ]);
  });

  it('removes a job an older version registered under another name', async () => {
    const { port, result } = await renderRegistration(true, {
      scheduled: [{ name: 'tasks.legacy-sync', intervalMinutes: BACKGROUND_INTERVAL_MINUTES }],
    });

    await waitFor(() => {
      expect(result.current).toBe('available');
    });
    expect(port.schedule().map((task) => task.name)).toStrictEqual(['tasks.sync-outbox']);
  });

  it('changes nothing on a restricted device and tells the setting row', async () => {
    const { port, result } = await renderRegistration(true, { availability: 'restricted' });

    await waitFor(() => {
      expect(result.current).toBe('restricted');
    });
    expect(port.calls()).toStrictEqual([]);
  });

  it('reports failed when the system refuses a registration', async () => {
    const { result } = await renderRegistration(true, { failingNames: ['tasks.sync-outbox'] });

    await waitFor(() => {
      expect(result.current).toBe('failed');
    });
  });
});
