// src/api/tasks/task-mutations.ts
// Each Tasks write is defined once, with mutationOptions, and says what it does to the cache. The
// toggle is optimistic: it cancels in-flight task queries (a late refetch would overwrite the
// optimistic value), snapshots every cached list, writes the change, restores the snapshot on
// failure and refetches when it settles. Create waits for the server and then refreshes the lists.
import { mutationOptions } from '@tanstack/react-query';

import { unwrap } from '@/api/api-error';

import { taskKeys } from './task-keys';
import { taskSchema } from './task-schemas';

import type { ApiTask, NewTaskRequest } from './task-schemas';
import type { ApiClient } from '@/api/api-client';
import type { ApiMutationOptions } from '@/api/api-query-options';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

export type ToggleTaskInput = { readonly id: string; readonly isDone: boolean };

/** What onMutate saved, to roll back: every cached list as it was before the change. */
export type TaskListsSnapshot = {
  readonly lists: readonly (readonly [QueryKey, readonly ApiTask[] | undefined])[];
};

function withDone(
  tasks: readonly ApiTask[] | undefined,
  input: ToggleTaskInput,
): readonly ApiTask[] | undefined {
  return tasks?.map((task) => (task.id === input.id ? { ...task, isDone: input.isDone } : task));
}

/**
 * Tasks mutations. The model hook passes the ApiClient from useServices() and the QueryClient from
 * useQueryClient() (TanStack's positional callbacks would not fit the three-parameter limit).
 */
export const taskMutations = {
  toggle: (
    api: ApiClient,
    queryClient: QueryClient,
  ): ApiMutationOptions<ApiTask, ToggleTaskInput, TaskListsSnapshot> =>
    mutationOptions<ApiTask, Error, ToggleTaskInput, TaskListsSnapshot>({
      mutationFn: (input) =>
        unwrap(
          api.request({
            method: 'PATCH',
            path: `/tasks/${encodeURIComponent(input.id)}`,
            body: { isDone: input.isDone },
            schema: taskSchema,
          }),
        ),
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: taskKeys.all });
        const lists = queryClient.getQueriesData<readonly ApiTask[]>({
          queryKey: taskKeys.lists(),
        });
        queryClient.setQueriesData<readonly ApiTask[]>({ queryKey: taskKeys.lists() }, (tasks) =>
          withDone(tasks, input),
        );
        return { lists };
      },
      onError: (_error, _input, snapshot) => {
        for (const [key, tasks] of snapshot?.lists ?? []) queryClient.setQueryData(key, tasks);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    }),
  create: (api: ApiClient, queryClient: QueryClient): ApiMutationOptions<ApiTask, NewTaskRequest> =>
    mutationOptions<ApiTask, Error, NewTaskRequest>({
      mutationFn: (input) =>
        unwrap(
          api.request({
            method: 'POST',
            path: '/tasks',
            body: { title: input.title },
            idempotencyKey: input.requestId,
            schema: taskSchema,
          }),
        ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
    }),
};
