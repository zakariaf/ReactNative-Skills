// src/features/tasks/use-tasks-model.test.tsx
// The model reads its copy through useT(), which needs I18nProvider. test/test-app.tsx (the
// canonical provider tree) carries no app catalogs, so this test puts the app's real I18nProvider
// (the en catalog, a throwing onError) inside the providers createProvidersWrapper builds.
import { act, renderHook } from '@testing-library/react-native';

import { I18nProvider } from '@/i18n/i18n-provider';
import { createProvidersWrapper } from '@test/render-with-providers';

import { SAMPLE_TASKS, useTasksModel } from './use-tasks-model';

import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

/** A fresh provider tree for one test: the canonical providers, then the app's I18nProvider. */
function i18nWrapper(): (props: { readonly children: ReactNode }) => ReactNode {
  const { wrapper: Providers } = createProvidersWrapper();
  return function I18nWrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <Providers>
        <I18nProvider language="en" digits="automatic" onError={failOnError}>
          {children}
        </I18nProvider>
      </Providers>
    );
  };
}

describe('useTasksModel', () => {
  it('starts with the sample tasks, open ones first', async () => {
    const { result } = await renderHook(() => useTasksModel(), { wrapper: i18nWrapper() });

    expect(result.current.tasks).toHaveLength(SAMPLE_TASKS.length);
    expect(result.current.tasks.map((task) => task.title)).toStrictEqual([
      'Answer email',
      'Buy milk',
      'Water the plants',
    ]);
  });

  it('counts the open tasks in the summary', async () => {
    const { result } = await renderHook(() => useTasksModel(), { wrapper: i18nWrapper() });

    expect(result.current.summary).toBe('2 open tasks');
  });

  it('toggles a task, then sorts it and counts it again', async () => {
    const { result } = await renderHook(() => useTasksModel(), { wrapper: i18nWrapper() });

    await act(() => {
      result.current.onToggle('task-2');
    });

    expect(result.current.summary).toBe('1 open task');
    expect(result.current.tasks.map((task) => task.id)).toStrictEqual([
      'task-3',
      'task-2',
      'task-1',
    ]);
  });

  it('does not ask for reduced motion while the phone does not', async () => {
    const { result } = await renderHook(() => useTasksModel(), { wrapper: i18nWrapper() });

    expect(result.current.isReducedMotion).toBe(false);
  });
});
