// src/api/tasks/task-keys.ts
// Every query key of the Tasks resource comes from here, hierarchical from the general to the
// specific, so one prefix reaches a whole family: invalidateQueries({ queryKey: taskKeys.all })
// refreshes every list and every detail, taskKeys.lists() every list. An inline ['tasks'] elsewhere
// is a typo waiting to miss an invalidation.

export const TASK_LIST_FILTERS = ['all', 'open', 'done'] as const;
export type TaskListFilter = (typeof TASK_LIST_FILTERS)[number];

const ALL = ['tasks'] as const;

/** Query keys of the Tasks resource. */
export const taskKeys = {
  all: ALL,
  lists: () => [...ALL, 'list'] as const,
  list: (filter: TaskListFilter) => [...ALL, 'list', { filter }] as const,
  /**
   * The paged list (useInfiniteQuery). Not under lists(): its data has another shape (InfiniteData),
   * so an updater written for the plain lists must never reach it; taskKeys.all still does.
   */
  pages: () => [...ALL, 'pages'] as const,
  details: () => [...ALL, 'detail'] as const,
  detail: (id: string) => [...ALL, 'detail', id] as const,
};
