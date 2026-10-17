// src/features/task-details/use-task-details-model.test.ts (example: a shape to imitate, never copied)
// Race tests: each request settles only when the test says so, so the order of answers is the
// test's choice, not the network's. Assumes Services has `taskDetails` (task-details-port.ts).
import { act } from '@testing-library/react-native';

import { err, ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { renderHookWithProviders } from '@test/render-with-providers';

import { useTaskDetailsModel } from './use-task-details-model';

import type { Result } from '@/core/result';
import type {
  TaskDetails,
  TaskDetailsFailure,
  TaskDetailsPort,
} from '@/services/task-details/task-details-port';

type LoadCall = {
  readonly taskId: string;
  readonly signal: AbortSignal;
  readonly settle: (result: Result<TaskDetails, TaskDetailsFailure>) => void;
  readonly fail: (error: unknown) => void;
};

/** A TaskDetailsPort whose loads wait for the test; `calls` lists them in order. */
function createControlledTaskDetails(): {
  readonly port: TaskDetailsPort;
  readonly calls: LoadCall[];
} {
  const calls: LoadCall[] = [];
  const port: TaskDetailsPort = {
    load: (taskId, signal) => {
      const pending = Promise.withResolvers<Result<TaskDetails, TaskDetailsFailure>>();
      calls.push({ taskId, signal, settle: pending.resolve, fail: pending.reject });
      return pending.promise;
    },
    search: () => Promise.resolve(ok([])),
  };
  return { port, calls };
}

function task(id: string): TaskDetails {
  return { id, title: `Task ${id}`, notes: '', isDone: false };
}

function callAt(calls: readonly LoadCall[], index: number): LoadCall {
  const call = calls[index];
  if (call === undefined) throw new Error(`no load call #${String(index)}`);
  return call;
}

describe('useTaskDetailsModel', () => {
  it('shows the task once it loads', async () => {
    const { port, calls } = createControlledTaskDetails();
    const { result } = await renderHookWithProviders(() => useTaskDetailsModel('task-1'), {
      services: { taskDetails: port, errorLog: createFakeErrorLog() },
    });

    expect(result.current.state).toStrictEqual({ status: 'loading' });

    await act(() => {
      callAt(calls, 0).settle(ok(task('task-1')));
    });

    expect(result.current.state).toStrictEqual({ status: 'loaded', task: task('task-1') });
  });

  it('keeps the newer task when the older request answers last', async () => {
    const { port, calls } = createControlledTaskDetails();
    let taskId = 'task-1';
    const { result, rerender } = await renderHookWithProviders(() => useTaskDetailsModel(taskId), {
      services: { taskDetails: port, errorLog: createFakeErrorLog() },
    });
    taskId = 'task-2';
    await rerender(undefined);

    expect(callAt(calls, 0).signal.aborted).toBe(true);
    expect(result.current.state).toStrictEqual({ status: 'loading' });

    await act(() => {
      callAt(calls, 1).settle(ok(task('task-2')));
    });
    await act(() => {
      callAt(calls, 0).settle(ok(task('task-1')));
    });

    expect(result.current.state).toStrictEqual({ status: 'loaded', task: task('task-2') });
  });

  it('aborts the request on unmount and records nothing when it then fails', async () => {
    const { port, calls } = createControlledTaskDetails();
    const errorLog = createFakeErrorLog();
    const { unmount } = await renderHookWithProviders(() => useTaskDetailsModel('task-1'), {
      services: { taskDetails: port, errorLog },
    });
    await unmount();

    expect(callAt(calls, 0).signal.aborted).toBe(true);

    await act(() => {
      callAt(calls, 0).fail(new Error('database is closed'));
    });

    expect(errorLog.recorded).toHaveLength(0);
  });

  it('shows an expected failure and loads again on retry', async () => {
    const { port, calls } = createControlledTaskDetails();
    const { result } = await renderHookWithProviders(() => useTaskDetailsModel('task-1'), {
      services: { taskDetails: port, errorLog: createFakeErrorLog() },
    });
    await act(() => {
      callAt(calls, 0).settle(err({ kind: 'timed-out', afterMs: 8000 }));
    });

    expect(result.current.state).toStrictEqual({
      status: 'failed',
      failure: { kind: 'timed-out', afterMs: 8000 },
    });

    await act(() => {
      result.current.onRetry();
    });

    expect(result.current.state).toStrictEqual({ status: 'loading' });
    expect(calls).toHaveLength(2);
  });

  it('records an unexpected rejection while the request is current', async () => {
    const { port, calls } = createControlledTaskDetails();
    const errorLog = createFakeErrorLog();
    await renderHookWithProviders(() => useTaskDetailsModel('task-1'), {
      services: { taskDetails: port, errorLog },
    });
    const failure = new Error('adapter bug');
    await act(() => {
      callAt(calls, 0).fail(failure);
    });

    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual([failure]);
  });
});
