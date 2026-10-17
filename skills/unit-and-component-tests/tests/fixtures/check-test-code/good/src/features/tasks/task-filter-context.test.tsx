// src/features/tasks/task-filter-context.test.tsx
import { renderHook } from '@testing-library/react-native';

import { createProvidersWrapper } from '@test/render-with-providers';

import { useTaskFilter } from './task-filter-context';

describe('useTaskFilter', () => {
  it('reads the filter the app provides', async () => {
    const { wrapper } = createProvidersWrapper();
    const { result } = await renderHook(() => useTaskFilter(), { wrapper });

    expect(result.current.filter).toBe('all');
  });

  it('throws when no provider is above the hook', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    // Proving the hook fails outside its provider needs a render without the providers.
    await expect(renderHook(() => useTaskFilter())).rejects.toThrow(
      'useTaskFilter() needs a <TaskFilterProvider> above it',
    );
    spy.mockRestore();
  });
});
