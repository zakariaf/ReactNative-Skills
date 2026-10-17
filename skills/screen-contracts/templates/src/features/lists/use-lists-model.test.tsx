// src/features/lists/use-lists-model.test.tsx
// The model reads the data layer through useAppData() and its copy through useT(): this test puts the
// app's real I18nProvider (the en catalog, a throwing onError) and an AppDataProvider over fakes inside
// the providers createProvidersWrapper builds.
import { act, renderHook } from '@testing-library/react-native';

import { err, ok } from '@/core/result';
import { AppDataProvider } from '@/data/app-data-context';
import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository';
import { isolate } from '@/i18n/bidi';
import { I18nProvider } from '@/i18n/i18n-provider';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createProvidersWrapper } from '@test/render-with-providers';

import { useListsModel } from './use-lists-model';

import type { Result } from '@/core/result';
import type { AppData } from '@/data/app-data-context';
import type { TaskRepository } from '@/data/tasks/task-repository';
import type { ReactNode } from 'react';

const UNAVAILABLE = { kind: 'storage-unavailable', code: null } as const;

function valueOf<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
}

function failOnError(error: Error): never {
  throw error;
}

function dataWith(tasks: TaskRepository): AppData {
  return {
    database: {
      outcome: { kind: 'unreadable', reason: 'test' },
      isPersistent: false,
      checkpoint: () => undefined,
    },
    errorLog: createFakeErrorLog(),
    tasks,
    resetAllData: () => ok(undefined),
  };
}

/** A fresh provider tree for one test: the canonical providers, the data layer, then the app's I18nProvider. */
function wrapperWith(
  tasks: TaskRepository,
): (props: { readonly children: ReactNode }) => ReactNode {
  const { wrapper: Providers } = createProvidersWrapper();
  const data = dataWith(tasks);
  return function ListsWrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <Providers>
        <AppDataProvider data={data}>
          <I18nProvider language="en" digits="automatic" onError={failOnError}>
            {children}
          </I18nProvider>
        </AppDataProvider>
      </Providers>
    );
  };
}

describe('useListsModel', () => {
  it('shows the saved lists in the default state', async () => {
    const tasks = createFakeTaskRepository();
    tasks.addList({ name: 'Inbox' });

    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });

    expect(result.current.state.kind).toBe('default');
    expect(result.current.title).toBe('Lists');
  });

  it('shows the empty state with its translated copy when there are no lists', async () => {
    const { result } = await renderHook(() => useListsModel(), {
      wrapper: wrapperWith(createFakeTaskRepository()),
    });

    expect(result.current.state).toStrictEqual({ kind: 'empty' });
    expect(result.current.emptyTitle).toBe('No lists yet');
    expect(result.current.emptyBody).toBe('Make a list to group your tasks.');
  });

  it('shows the error state when the lists cannot be read', async () => {
    const tasks: TaskRepository = { ...createFakeTaskRepository(), lists: () => err(UNAVAILABLE) };

    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });

    expect(result.current.state).toStrictEqual({ kind: 'error', failure: UNAVAILABLE });
    expect(result.current.retryLabel).toBe('Try again');
  });

  it('reads the lists again on retry', async () => {
    const fake = createFakeTaskRepository();
    let isBroken = true;
    const tasks: TaskRepository = {
      ...fake,
      lists: () => (isBroken ? err(UNAVAILABLE) : fake.lists()),
    };
    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });
    isBroken = false;
    fake.addList({ name: 'Groceries' });

    await act(() => {
      result.current.onRetry();
    });

    expect(result.current.state.kind).toBe('default');
  });

  it('opens the delete dialog for the list a person asked to delete, with its name', async () => {
    const tasks = createFakeTaskRepository();
    const groceries = valueOf(tasks.addList({ name: 'Groceries' }));
    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });
    expect(result.current.deleteDialog).toBeNull();

    await act(() => {
      result.current.onAskDelete(groceries.id);
    });

    expect(result.current.deleteDialog?.title).toBe(`Delete ${isolate('Groceries')}?`);
    expect(result.current.deleteLabelOf('Groceries')).toBe(`Delete ${isolate('Groceries')}`);
  });

  it('deletes the list on confirm and closes the dialog', async () => {
    const tasks = createFakeTaskRepository();
    const groceries = valueOf(tasks.addList({ name: 'Groceries' }));
    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });

    await act(() => {
      result.current.onAskDelete(groceries.id);
    });
    await act(() => {
      result.current.onConfirmDelete();
    });

    expect(result.current.deleteDialog).toBeNull();
    expect(result.current.state).toStrictEqual({ kind: 'empty' });
  });

  it('keeps the list on cancel', async () => {
    const tasks = createFakeTaskRepository();
    const groceries = valueOf(tasks.addList({ name: 'Groceries' }));
    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });

    await act(() => {
      result.current.onAskDelete(groceries.id);
    });
    await act(() => {
      result.current.onCancelDelete();
    });

    expect(result.current.deleteDialog).toBeNull();
    expect(result.current.state.kind).toBe('default');
  });

  it('shows the error state when the delete fails', async () => {
    const tasks = createFakeTaskRepository();
    const groceries = valueOf(tasks.addList({ name: 'Groceries' }));
    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });
    tasks.failNextWrite = { kind: 'storage-busy' };

    await act(() => {
      result.current.onAskDelete(groceries.id);
    });
    await act(() => {
      result.current.onConfirmDelete();
    });

    expect(result.current.state).toStrictEqual({
      kind: 'error',
      failure: { kind: 'storage-busy' },
    });
  });

  it('does nothing on confirm when no delete is pending', async () => {
    const tasks = createFakeTaskRepository();
    tasks.addList({ name: 'Groceries' });
    const { result } = await renderHook(() => useListsModel(), { wrapper: wrapperWith(tasks) });

    await act(() => {
      result.current.onConfirmDelete();
    });

    expect(result.current.state.kind).toBe('default');
  });
});
