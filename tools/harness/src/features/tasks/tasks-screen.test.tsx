// src/features/tasks/tasks-screen.test.tsx
// The view test of the Tasks screen (contracts/screens.json, screen "tasks"): it finds every testID of
// the screen, fires its handler, and ends every block that renders with the pressable audit
// (screen-contracts' state-test-audit).
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
  { id: 'task-3', title: 'Answer email', isDone: false },
];

async function renderTasks(onToggle: (id: string) => void = jest.fn()): Promise<void> {
  await renderWithProviders(
    <TasksScreen
      summary="2 open tasks"
      tasks={sortTasks(TASKS, 'en')}
      onToggle={onToggle}
      isReducedMotion={false}
    />,
  );
}

describe('TasksScreen', () => {
  it('shows the list, the summary and one row per task in the default state', async () => {
    await renderTasks();

    for (const testID of [
      'tasks.list',
      'tasks.summary',
      'tasks.task-row.task-1',
      'tasks.task-row.task-2',
      'tasks.task-row.task-3',
    ]) {
      expect(screen.getByTestId(testID, HIDDEN)).toBeOnTheScreen();
    }
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('lists open tasks before done tasks, each group by title', async () => {
    await renderTasks();

    const [first, second, third] = screen.getAllByRole('checkbox');
    expect(first).toHaveAccessibleName('Answer email');
    expect(second).toHaveAccessibleName('Buy milk');
    expect(third).toHaveAccessibleName('Water the plants');
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('marks done tasks as checked and open tasks as unchecked', async () => {
    await renderTasks();

    expect(screen.getByRole('checkbox', { name: 'Water the plants' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Buy milk' })).not.toBeChecked();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows the summary it is given', async () => {
    await renderTasks();

    expect(screen.getByText('2 open tasks')).toBeOnTheScreen();
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
