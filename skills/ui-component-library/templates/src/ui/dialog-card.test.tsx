// src/ui/dialog-card.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { Button } from './button';
import { DialogButtonRow } from './dialog-button-row';
import { DialogCard } from './dialog-card';
import { Scrim } from './scrim';

describe('DialogCard', () => {
  it('derives the title and body parts, and is never the modal root itself', async () => {
    const onCancel = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <Scrim testID="delete-task-dialog.scrim" isVisible onRequestClose={onCancel} isReducedMotion>
        <DialogCard
          testID="delete-task-dialog.card"
          title="Delete this task?"
          body="You can't undo this."
        >
          <DialogButtonRow testID="delete-task-dialog.buttons">
            <Button
              label="Cancel"
              onPress={onCancel}
              testID="delete-task-dialog.cancel-button"
              isInRow
              isReducedMotion
            />
            <Button
              label="Delete"
              variant="danger"
              onPress={jest.fn()}
              testID="delete-task-dialog.confirm-button"
              isInRow
              isReducedMotion
            />
          </DialogButtonRow>
        </DialogCard>
      </Scrim>,
    );

    expect(screen.getByRole('header', { name: 'Delete this task?' })).toBeOnTheScreen();
    expect(screen.getByTestId('delete-task-dialog.card.body')).toHaveTextContent(
      "You can't undo this.",
    );
    expect(screen.getByTestId('delete-task-dialog.card')).not.toHaveProp(
      'accessibilityViewIsModal',
    );
    await user.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
