// src/features/tasks/use-tasks-model.test.tsx
import { act, renderHook } from '@testing-library/react-native';

import { createProvidersWrapper, renderHookWithProviders } from '@test/render-with-providers';

import { useTasksModel } from './use-tasks-model';

describe('useTasksModel', () => {
  it('starts from the seeded tasks', async () => {
    const { result } = await renderHookWithProviders(() => useTasksModel(), {
      seed: { tasks: [{ id: 'task-1', title: 'Buy milk', isDone: false }] },
    });

    expect(result.current.openCount).toBe(1);
  });

  it('follows a dispatch on the returned stores', async () => {
    const { wrapper, stores } = createProvidersWrapper();
    const { result } = await renderHook(() => useTasksModel(), { wrapper });

    await act(() => {
      stores.tasks.getState().dispatch({ type: 'task-added', title: 'Answer email' });
    });

    expect(result.current.openCount).toBe(1);
  });
});
