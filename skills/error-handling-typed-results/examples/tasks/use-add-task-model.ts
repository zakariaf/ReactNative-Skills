// src/features/tasks/use-add-task-model.ts (example: a shape to imitate, never copied)
// Never lose what the user typed: the title stays in the model until the write returns ok; a failure
// becomes a message (with the title still in the field) and the user retries or edits. The screen's
// handler calls the void intent `add`, never the repository, so no Result can be dropped in a handler.
import { useState } from 'react';

import { taskFailureMessage } from './task-failure-message';

import type { FailureMessage } from './task-failure-message';
import type { TaskRepository } from '@/data/tasks/task-repository';

export type AddTaskModel = {
  readonly title: string;
  readonly failure: FailureMessage | null;
  readonly setTitle: (title: string) => void;
  /** Saves the title; clears the field only after the task is stored. */
  readonly add: () => void;
};

export function useAddTaskModel(repository: TaskRepository, newId: () => string): AddTaskModel {
  const [title, setTitle] = useState('');
  const [failure, setFailure] = useState<FailureMessage | null>(null);
  const add = (): void => {
    const result = repository.add({ id: newId(), title });
    if (!result.ok) {
      setFailure(taskFailureMessage(result.error));
      return;
    }
    setFailure(null);
    setTitle('');
  };
  const editTitle = (next: string): void => {
    setTitle(next);
    setFailure(null);
  };
  return { title, failure, setTitle: editTitle, add };
}
