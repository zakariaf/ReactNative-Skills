// examples/complete-task.ts — a shape to imitate, not a file to copy.
// Completing a task in a Tasks app: the completion is folded by the pure recordCompletion, and the
// task row and the progress row are written in ONE transaction before the checkmark animates, then
// every store re-reads (updateAndPublish, state-management-zustand). Two homes in a real app:
//   src/data/tasks/sqlite-task-repository.ts   the `complete` method (persistence-and-migrations
//                                              owns the tables, the migration and the row schemas)
//   src/features/tasks/use-tasks-model.ts      the handler (the only code that reads the clock)

import { measureCounters } from '@/core/stats/activity-stats';
import { recordCompletion } from '@/core/stats/record-completion';

import type { DateKey } from '@/core/dates/date-key';
import type { CounterSpec } from '@/core/stats/activity-stats';
import type { ActivityProgress, Completion } from '@/core/stats/record-completion';

/** What the streak keeps for an active day in this app: the first task completed that day. */
export type TasksDay = { readonly firstTaskId: number };
export type TasksProgress = ActivityProgress<TasksDay>;

type Subtask = { readonly title: string; readonly isDone: boolean };
type DoneTask = {
  readonly id: number;
  readonly dueOn: DateKey | null;
  readonly isSample: boolean;
  readonly subtasks: readonly Subtask[];
};

/**
 * Counter ids are stored keys: kebab-case, never renamed (a rename is a data migration).
 * measureCounters measures per step: 'sum' adds the steps, 'max' keeps the largest single STEP.
 */
const TASK_COUNTERS: readonly CounterSpec<Subtask>[] = [
  { id: 'subtasks-completed', aggregate: 'sum', measure: (step) => (step.isDone ? 1 : 0) },
];

/** Pure (feature logic, tested beside it): on time when done on or before its due day. */
export function completionOf(task: DoneTask, today: DateKey): Completion<TasksDay> {
  return {
    day: today, // a task completes in an instant; a timed session would pass the day it STARTED
    dayResult: { firstTaskId: task.id },
    event: {
      isSuccess: task.dueOn === null || today <= task.dueOn, // DateKeys compare as strings
      durationMs: 0,
      counters: {
        ...measureCounters(TASK_COUNTERS, task.subtasks),
        // A record of the whole EVENT (the biggest checklist ever completed) is measured here, once
        // per event, and folded across events by 'max'. A per-step 'max' would read 1 for every task.
        'longest-checklist': { value: task.subtasks.length, aggregate: 'max' },
      },
    },
    isPractice: task.isSample, // the onboarding sample task never counts
  };
}

// --- src/data/tasks/sqlite-task-repository.ts (inside createSqliteTaskRepository) ---------------
//
//   complete: (input) => attempt(() => {
//     driver.transaction(() => {
//       driver.run('UPDATE tasks SET is_done = 1, completed_at_ms = ? WHERE id = ?',
//         [input.completedAtMs, input.taskId]);
//       driver.run('INSERT OR REPLACE INTO activity_progress (id, body) VALUES (1, ?)',
//         [JSON.stringify(input.progress)]);   // the row schema validates it on read
//     });
//   }, toTaskFailure),
//
// One transaction: a kill between the two statements would leave a done task without its streak
// day (or a streak day without its task), and no later read could tell which one is right.

// --- src/features/tasks/use-tasks-model.ts (the handler) -----------------------------------------
//
//   const { clock } = useServices();
//   const stores = useStores();
//   ...
//   onComplete: (task) => {
//     const today = clock.today();                            // read again, inside the handler
//     const { progress } = stores.progress.getState();        // and the state too: a value the
//                                                             // render captured is stale after a
//                                                             // second tap in the same frame
//     const next = recordCompletion(progress, completionOf(task, today));
//     const result = updateAndPublish(stores, () =>
//       tasks.complete({ taskId: task.id, completedAtMs: clock.nowMs(), progress: next }),
//     );
//     if (!result.ok) showFailure(result.error);              // nothing was published
//   },

/** The fold the handler runs, shown alone: practice changes nothing, so nothing is written. */
export function nextProgress(
  progress: TasksProgress,
  task: DoneTask,
  today: DateKey,
): TasksProgress {
  return recordCompletion(progress, completionOf(task, today));
}
