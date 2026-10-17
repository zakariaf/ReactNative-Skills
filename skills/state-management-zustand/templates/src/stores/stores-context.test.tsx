// src/stores/stores-context.test.tsx
import { renderHook } from '@testing-library/react-native';

import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository';
import { createStores } from '@/stores/create-stores';
import { StoresProvider, useStores } from '@/stores/stores-context';

import type { ReactNode } from 'react';

describe('StoresProvider', () => {
  it('hands down the stores it was given', async () => {
    const stores = createStores({ tasks: createFakeTaskRepository() });
    const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
      <StoresProvider stores={stores}>{children}</StoresProvider>
    );
    const { result } = await renderHook(() => useStores(), { wrapper });
    expect(result.current).toBe(stores);
  });

  it('throws without a provider (a programmer error, never a silent default)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useStores())).rejects.toThrow(
      'useStores() needs a <StoresProvider> above it',
    );
  });

  it('creates fresh stores on every call', () => {
    const tasks = createFakeTaskRepository();
    expect(createStores({ tasks }).tasks).not.toBe(createStores({ tasks }).tasks);
  });
});
