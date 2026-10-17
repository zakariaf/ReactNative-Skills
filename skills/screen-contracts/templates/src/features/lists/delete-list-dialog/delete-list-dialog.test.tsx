// src/features/lists/delete-list-dialog/delete-list-dialog.test.tsx
// The view test of the delete-list dialog: it finds every contract testID, fires both handlers and
// audits the dialog for inaccessible pressables in every block that renders it. Android's back button
// and back gesture reach the dialog as the Modal's requestClose event, fired here on the Modal itself.
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { DeleteListDialog } from './delete-list-dialog';

const HIDDEN = { includeHiddenElements: true } as const;

async function renderDialog(
  handlers: { onConfirm?: () => void; onCancel?: () => void } = {},
): Promise<void> {
  await renderWithProviders(
    <DeleteListDialog
      title="Delete Groceries?"
      body="Its tasks are deleted too."
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={handlers.onConfirm ?? jest.fn()}
      onCancel={handlers.onCancel ?? jest.fn()}
      isReducedMotion={false}
    />,
  );
}

type HostNode = ReturnType<typeof screen.getByTestId>;

/** The nearest ancestor that carries onRequestClose: the Modal the dialog is drawn in. */
function modalOf(node: HostNode): HostNode {
  let current: HostNode | null = node;
  while (current !== null && current.props['onRequestClose'] === undefined) {
    current = current.parent;
  }
  if (current === null) throw new Error('the dialog is not drawn in a Modal with onRequestClose');
  return current;
}

describe('DeleteListDialog', () => {
  it('shows the title, the body and both actions in the default state', async () => {
    await renderDialog();

    for (const testID of [
      'delete-list-dialog.scrim',
      'delete-list-dialog.card',
      'delete-list-dialog.title',
      'delete-list-dialog.body',
      'delete-list-dialog.cancel-button',
      'delete-list-dialog.confirm-button',
    ]) {
      expect(screen.getByTestId(testID, HIDDEN)).toBeOnTheScreen();
    }
    expect(screen.getByRole('header', { name: 'Delete Groceries?' })).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('confirms with the delete button', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    await renderDialog({ onConfirm });

    await user.press(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('cancels with the cancel button', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    await renderDialog({ onCancel });

    await user.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('cancels on Android back (the Modal requestClose event)', async () => {
    const onCancel = jest.fn();
    await renderDialog({ onCancel });

    await fireEvent(
      modalOf(screen.getByTestId('delete-list-dialog.scrim', HIDDEN)),
      'requestClose',
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
