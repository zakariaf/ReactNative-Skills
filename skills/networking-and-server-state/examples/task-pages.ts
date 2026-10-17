// src/api/tasks/task-pages.ts (example: a paged list with infiniteQueryOptions and a cursor)
// The server answers { items, nextCursor }; nextCursor null means the last page. The signal goes to the
// request like in every queryFn. Keep the number of cached pages bounded (maxPages): a refetch of an
// infinite query refetches every cached page in order, from the first.
import { infiniteQueryOptions } from '@tanstack/react-query';
import * as v from 'valibot';

import { unwrap } from '@/api/api-error';

import { taskKeys } from './task-keys';
import { taskSchema } from './task-schemas';

import type { ApiClient } from '@/api/api-client';
import type { ApiInfiniteQueryOptions } from '@/api/api-query-options';

const taskPageSchema = v.object({
  items: v.array(taskSchema),
  nextCursor: v.nullable(v.string()),
});

export type TaskPage = v.InferOutput<typeof taskPageSchema>;

/** Pages of 50 tasks, newest first; useInfiniteQuery(taskPages(api)) in the model hook. */
export function taskPages(
  api: ApiClient,
): ApiInfiniteQueryOptions<TaskPage, ReturnType<typeof taskKeys.pages>, string | null> {
  return infiniteQueryOptions({
    queryKey: taskKeys.pages(),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.request({
          method: 'GET',
          path: '/tasks',
          query: { cursor: pageParam ?? undefined, limit: 50 },
          schema: taskPageSchema,
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    maxPages: 10,
  });
}
