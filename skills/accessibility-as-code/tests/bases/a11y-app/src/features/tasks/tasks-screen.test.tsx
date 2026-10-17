// src/features/tasks/tasks-screen.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { TasksScreen } from './tasks-screen';

describe('TasksScreen', () => {
  it('names every task for screen readers and opens the tapped one', async () => {
    const onOpenTask = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(<TasksScreen onOpenTask={onOpenTask} />);

    await user.press(screen.getByRole('button', { name: 'Buy milk, due tomorrow' }));

    expect(onOpenTask).toHaveBeenCalledWith('task-2');
    expect(screen.getByRole('header', { name: 'Today' })).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
