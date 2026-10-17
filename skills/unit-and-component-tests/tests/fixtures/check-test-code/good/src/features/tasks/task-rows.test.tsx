// src/features/tasks/task-rows.test.tsx
import { screen, userEvent, within } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { TasksScreen } from './tasks-screen';

const SEED = {
  tasks: [
    { id: 'task-1', title: 'Buy milk', isDone: false },
    { id: 'task-2', title: 'Answer email', isDone: false },
  ],
};

/** Two open tasks; every caller awaits it. */
const showTwoTasks = () => renderWithProviders(<TasksScreen />, { seed: SEED });

describe('TasksScreen rows', () => {
  it('scopes queries to one row', async () => {
    await showTwoTasks();

    expect(await within(screen.getByTestId('tasks.row.task-1')).findByText('Buy milk')).toBeOnTheScreen();
    expect(
      await within(screen.getAllByRole('checkbox')[1])
        .findByText('Answer email'),
    ).toBeOnTheScreen();
  });

  it('completes two tasks pressed together', async () => {
    const user = userEvent.setup();
    await showTwoTasks();

    await Promise.all([
      user.press(screen.getByRole('checkbox', { name: 'Buy milk' })),
      user.press(screen.getByRole('checkbox', { name: 'Answer email' })),
    ]);

    await expect(screen.findByRole('checkbox', { name: 'Buy milk', checked: true })).resolves.toBeOnTheScreen();
  });

  it('completes every task pressed together', async () => {
    const user = userEvent.setup();
    await showTwoTasks();

    await Promise.all(['Buy milk', 'Answer email'].map((name) => user.press(screen.getByRole('checkbox', { name }))));

    expect(await screen.findAllByRole('checkbox', { checked: true })).toHaveLength(2);
  });
});
