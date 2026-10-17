// src/features/tasks/use-add-task-model.test.ts (example: a shape to imitate, never copied)
// The never-lose-input test: a failed write keeps every character the user typed and says why; only a
// stored task clears the field. The fake repository fails on demand, with a typed failure.
// no-providers: useAddTaskModel reads no context; its repository and id source are injected.
import { act, renderHook } from '@testing-library/react-native';

import { err, ok } from '@/core/result';

import { useAddTaskModel } from './use-add-task-model';

import type { Result } from '@/core/result';
import type { Task } from '@/core/tasks/task';
import type { TaskFailure } from '@/core/tasks/task-failure';
import type { TaskDraft, TaskRepository } from '@/data/tasks/task-repository';

function createFakeRepository(next: () => Result<Task, TaskFailure>): TaskRepository {
  return {
    add: (draft: TaskDraft) => {
      const result = next();
      return result.ok ? ok({ ...result.value, id: draft.id, title: draft.title }) : result;
    },
    rename: () => err({ kind: 'task-not-found', taskId: 'unused' }),
  };
}

describe('useAddTaskModel', () => {
  it('keeps the typed title and shows the failure when the write fails', async () => {
    const repository = createFakeRepository(() => err({ kind: 'storage-full' }));
    const { result } = await renderHook(() => useAddTaskModel(repository, () => 'task-1'));

    await act(() => {
      result.current.setTitle('Buy milk');
    });
    await act(() => {
      result.current.add();
    });

    expect(result.current.title).toBe('Buy milk');
    expect(result.current.failure).toStrictEqual({ key: 'errors.storage-full', values: {} });
  });

  it('clears the field only after the task is stored', async () => {
    const stored: Task = { id: 'task-1', title: 'Buy milk', isDone: false };
    const repository = createFakeRepository(() => ok(stored));
    const { result } = await renderHook(() => useAddTaskModel(repository, () => 'task-1'));

    await act(() => {
      result.current.setTitle('Buy milk');
    });
    await act(() => {
      result.current.add();
    });

    expect(result.current.title).toBe('');
    expect(result.current.failure).toBeNull();
  });

  it('passes the failing title into the message values', async () => {
    const repository = createFakeRepository(() =>
      err({ kind: 'task-title-taken', title: 'Buy milk' }),
    );
    const { result } = await renderHook(() => useAddTaskModel(repository, () => 'task-2'));

    await act(() => {
      result.current.setTitle('Buy milk');
    });
    await act(() => {
      result.current.add();
    });

    expect(result.current.failure).toStrictEqual({
      key: 'tasks.error.title-taken',
      values: { title: 'Buy milk' },
    });
  });
});
