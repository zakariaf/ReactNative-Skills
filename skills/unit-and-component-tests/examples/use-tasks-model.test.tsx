// src/features/tasks/use-tasks-model.test.tsx — EXAMPLE (a shape to imitate): a model hook that
// reads a store and a service, rendered inside the app's providers, seeded through the fake data
// layer the real store factories read, and changed the way the app changes it (a store action),
// never by mocking a store module.
import { act } from '@testing-library/react-native';

import { createFakeClock } from '@/services/clock/fake-clock';
import { renderHookWithProviders } from '@test/render-with-providers';

import { useTasksModel } from './use-tasks-model';

/** One list (id 1) holding one open task, "Buy milk" (id 2). */
const SEED = { lists: [{ name: 'Groceries' }], tasks: [{ listId: 1, title: 'Buy milk' }] };

describe('useTasksModel', () => {
  it('counts the seeded open tasks', async () => {
    const { result } = await renderHookWithProviders(() => useTasksModel(1), {
      seed: SEED,
      services: { clock: createFakeClock({ nowMs: 0, today: '2026-10-03' }) },
    });

    expect(result.current.openCount).toBe(1);
  });

  it('follows a task completed outside React', async () => {
    const { result, stores } = await renderHookWithProviders(() => useTasksModel(1), {
      seed: SEED,
    });

    await act(() => {
      stores.tasks.getState().setDone(2, true);
    });

    expect(result.current.openCount).toBe(0);
  });

  it('names the port a test forgot to pass', async () => {
    const { result } = await renderHookWithProviders(() => useTasksModel(1), { seed: SEED });

    await expect(result.current.scheduleReminders()).rejects.toThrow(
      'the test gave no reminders port',
    );
  });
});
