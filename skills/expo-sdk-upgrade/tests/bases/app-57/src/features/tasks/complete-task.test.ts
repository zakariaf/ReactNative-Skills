// src/features/tasks/complete-task.test.ts
import { completeTask } from './complete-task';

describe('completeTask', () => {
  it('saves the task as done', () => {
    const onSaved = jest.fn();
    completeTask({ id: 't1', isDone: false }, onSaved);
    expect(onSaved).toHaveBeenCalledWith({ id: 't1', isDone: true });
  });
});
