// src/ui/empty-state.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Button } from './button';
import { EmptyState } from './empty-state';
import { IconTile } from './icon-tile';

describe('EmptyState', () => {
  it('derives its parts, makes the title a header and hides the picture', async () => {
    const onAdd = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <EmptyState
        testID="tasks.empty-state"
        title="No tasks yet"
        body="Add your first task to get started."
        picture={<IconTile icon={() => null} size="large" />}
        action={
          <Button
            label="Add task"
            variant="primary"
            onPress={onAdd}
            testID="tasks.empty-state.add-button"
            isReducedMotion
          />
        }
      />,
    );

    expect(screen.getByRole('header', { name: 'No tasks yet' })).toBeOnTheScreen();
    expect(screen.getByTestId('tasks.empty-state.body')).toHaveTextContent(
      'Add your first task to get started.',
    );
    expect(screen.queryByTestId('tasks.empty-state.picture')).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Add task' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
