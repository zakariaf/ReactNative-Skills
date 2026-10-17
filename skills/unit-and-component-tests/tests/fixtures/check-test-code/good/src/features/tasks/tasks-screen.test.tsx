// src/features/tasks/tasks-screen.test.tsx
import { act, screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { TasksScreen } from './tasks-screen';

describe('TasksScreen', () => {
  it('adds a task through the form', async () => {
    const user = userEvent.setup();
    const { stores } = await renderWithProviders(<TasksScreen />);

    await user.type(screen.getByRole('textbox', { name: 'New task' }), 'Buy milk');
    await user.press(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Buy milk')).toBeOnTheScreen();
    expect(stores.tasks.getState().tasks).toHaveLength(1);
  });

  it('hides the empty state once a task exists', async () => {
    const { stores } = await renderWithProviders(<TasksScreen />);

    await act(() => {
      stores.tasks.getState().dispatch({ type: 'task-added', title: 'Answer email' });
    });

    expect(screen.queryByText('No tasks yet')).not.toBeOnTheScreen();
  });
});
