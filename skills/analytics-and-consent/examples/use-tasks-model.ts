// src/features/tasks/use-tasks-model.ts
// Tracking from a model hook (a shape): the event is sent from the press handler that did the work,
// with catalog values only. Never the task's title, never its id, never in render or an effect that
// re-runs.
import { useAnalytics } from '@/services/analytics/analytics-context';

/** What the editor hands over (the feature's own type; a shape here). */
type TaskDraft = {
  readonly listId: string;
  readonly dueDate: string | null;
  readonly reminder: string | null;
};

export type TasksModel = {
  readonly onCreate: (draft: TaskDraft) => void;
};

export function useTasksModel(save: (draft: TaskDraft) => void): TasksModel {
  const analytics = useAnalytics();
  return {
    onCreate: (draft) => {
      save(draft);
      analytics.track({
        name: 'task_created',
        props: {
          list_kind: draft.listId === 'inbox' ? 'inbox' : 'custom',
          has_due_date: draft.dueDate !== null,
          has_reminder: draft.reminder !== null,
        },
      });
    },
  };
}
