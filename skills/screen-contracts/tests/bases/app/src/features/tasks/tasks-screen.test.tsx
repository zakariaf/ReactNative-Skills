// src/features/tasks/tasks-screen.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { sortTasks } from './task-list';
import { TasksScreen } from './tasks-screen';

import type { Task } from './task-list';

const HIDDEN = { includeHiddenElements: true } as const;

const TASKS: readonly Task[] = [
  { id: 'task-1', title: 'Water the plants', isDone: true },
  { id: 'task-2', title: 'Buy milk', isDone: false },
];

async function renderTasks(onToggle: (id: string) => void = jest.fn()): Promise<void> {
  await renderWithProviders(
    <TasksScreen
      summary="1 open task"
      tasks={sortTasks(TASKS, 'en')}
      onToggle={onToggle}
      isReducedMotion={false}
    />,
  );
}

describe('TasksScreen', () => {
  it('shows the summary and one row per task in the default state', async () => {
    await renderTasks();

    for (const testID of ['tasks.list', 'tasks.summary', 'tasks.task-row.task-1']) {
      expect(screen.getByTestId(testID, HIDDEN)).toBeOnTheScreen();
    }
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('toggles the pressed task by its id', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    await renderTasks(onToggle);

    await user.press(screen.getByRole('checkbox', { name: 'Buy milk' }));

    expect(onToggle).toHaveBeenCalledWith('task-2');
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
