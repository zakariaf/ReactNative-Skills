// src/data/app-data-context.test.tsx: the provider hands the data layer to every hook below it.
import { renderHook } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { AppDataProvider, useAppData } from '@/data/app-data-context';
import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import type { AppData } from '@/data/app-data-context';
import type { JSX, ReactNode } from 'react';

/** Fakes only: the context carries the database's status and the repositories, never a driver. */
function inMemoryData(): AppData {
  return {
    database: {
      outcome: { kind: 'unreadable', reason: 'test' },
      isPersistent: false,
      checkpoint: () => undefined,
    },
    errorLog: createFakeErrorLog(),
    tasks: createFakeTaskRepository(),
    resetAllData: () => ok(undefined),
  };
}

describe('useAppData', () => {
  it('returns the data layer the provider hands down', async () => {
    const data = inMemoryData();
    const wrapper = ({ children }: { readonly children: ReactNode }): JSX.Element => (
      <AppDataProvider data={data}>{children}</AppDataProvider>
    );
    const { result } = await renderHook(() => useAppData(), { wrapper });

    expect(result.current).toBe(data);
    expect(result.current.database.isPersistent).toBe(false);
  });

  it('throws when no provider is above the hook', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(renderHook(() => useAppData())).rejects.toThrow(
      'useAppData() needs an <AppDataProvider> above it',
    );
    spy.mockRestore();
  });
});
