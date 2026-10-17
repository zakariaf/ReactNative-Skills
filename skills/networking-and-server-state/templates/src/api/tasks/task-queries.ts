// src/api/tasks/task-queries.ts
// Each Tasks query is defined once, with queryOptions: the key, the fetch and the freshness travel
// together, so useQuery, prefetchQuery and getQueryData all agree on the data's type. Every queryFn
// hands TanStack's signal to the client: TanStack aborts an abandoned fetch only when the signal was
// read, otherwise the request runs to the end after the screen is gone.
import { queryOptions } from '@tanstack/react-query';

import { unwrap } from '@/api/api-error';

import { taskKeys } from './task-keys';
import { taskListSchema, taskSchema } from './task-schemas';

import type { TaskListFilter } from './task-keys';
import type { ApiTask, TaskList } from './task-schemas';
import type { ApiClient } from '@/api/api-client';
import type { ApiQueryOptions } from '@/api/api-query-options';

/** Tasks queries; the ApiClient comes from useServices() in the model hook. */
export const taskQueries = {
  list: (
    api: ApiClient,
    filter: TaskListFilter,
  ): ApiQueryOptions<TaskList, ReturnType<typeof taskKeys.list>> =>
    queryOptions({
      queryKey: taskKeys.list(filter),
      queryFn: ({ signal }) =>
        unwrap(
          api.request({
            method: 'GET',
            path: '/tasks',
            query: { filter: filter === 'all' ? undefined : filter },
            schema: taskListSchema,
            signal,
          }),
        ),
    }),
  detail: (
    api: ApiClient,
    id: string,
  ): ApiQueryOptions<ApiTask, ReturnType<typeof taskKeys.detail>> =>
    queryOptions({
      queryKey: taskKeys.detail(id),
      queryFn: ({ signal }) =>
        unwrap(
          api.request({
            method: 'GET',
            path: `/tasks/${encodeURIComponent(id)}`,
            schema: taskSchema,
            signal,
          }),
        ),
    }),
};
