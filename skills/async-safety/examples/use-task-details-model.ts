// src/features/task-details/use-task-details-model.ts (example: a shape to imitate, never copied)
// Async work that is not server state (here a task read from the device's SQLite repository through
// a port; server data goes through useQuery instead, networking-and-server-state). An effect that
// starts async work owns its cancellation: one AbortController per run, aborted by
// the cleanup (the id changed, the user retried, the screen unmounted), and every write after the
// await checks that signal first. The loaded state remembers which request it answers, so a new id
// shows "loading" at once instead of the previous task. A cancelled load is not a failure: nothing
// is shown, nothing is recorded. Assumes the composition root provides
// `taskDetails: TaskDetailsPort` (task-details-port.ts).
import { useEffect, useState } from 'react';

import { useServices } from '@/services/services-context';

import type { TaskDetails, TaskDetailsFailure } from '@/services/task-details/task-details-port';

export type TaskDetailsState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly task: TaskDetails }
  | { readonly status: 'failed'; readonly failure: TaskDetailsFailure };

/** What the task details screen renders and calls. Callbacks return void (async-safety rule 2). */
export type TaskDetailsModel = {
  readonly state: TaskDetailsState;
  readonly onRetry: () => void;
};

type Answer = { readonly request: string; readonly state: TaskDetailsState };

const LOADING: TaskDetailsState = { status: 'loading' };

/** Loads one task; a newer id or a retry cancels the older request. */
export function useTaskDetailsModel(taskId: string): TaskDetailsModel {
  const { taskDetails, errorLog } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const request = `${taskId}#${String(attempt)}`;
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    taskDetails
      .load(taskId, signal)
      .then((result) => {
        if (signal.aborted) return;
        if (result.ok) setAnswer({ request, state: { status: 'loaded', task: result.value } });
        else if (result.error.kind !== 'cancelled')
          setAnswer({ request, state: { status: 'failed', failure: result.error } });
      })
      .catch((error: unknown) => {
        if (!signal.aborted) errorLog.record('service', error);
      });
    return () => {
      controller.abort();
    };
  }, [taskDetails, errorLog, taskId, request]);
  const onRetry = (): void => {
    setAttempt((value) => value + 1);
  };
  return { state: answer?.request === request ? answer.state : LOADING, onRetry };
}
