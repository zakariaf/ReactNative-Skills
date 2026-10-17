// src/features/lists/lists-screen.test.tsx
// The view test of the Lists screen: one block per contract state (default, empty, error), each
// finding that state's testIDs and ending with the pressable audit, plus each handler and the
// delete dialog it renders while the model holds a pending delete.
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { ListsScreen } from './lists-screen';

import type { ListsState } from './lists-state';
import type { DeleteListDialogModel, ListsModel } from './use-lists-model';

const HIDDEN = { includeHiddenElements: true } as const;

function modelWith(state: ListsState, overrides: Partial<ListsModel> = {}): ListsModel {
  return {
    title: 'Lists',
    state,
    emptyTitle: 'No lists yet',
    emptyBody: 'Make a list to group your tasks.',
    errorText: 'Your lists could not be loaded.',
    retryLabel: 'Try again',
    deleteText: 'Delete',
    deleteLabelOf: (listName) => `Delete ${listName}`,
    deleteDialog: null,
    onRetry: jest.fn(),
    onAskDelete: jest.fn(),
    onConfirmDelete: jest.fn(),
    onCancelDelete: jest.fn(),
    isReducedMotion: false,
    ...overrides,
  };
}

const DIALOG: DeleteListDialogModel = {
  title: 'Delete Groceries?',
  body: 'Its tasks are deleted too.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
};

const DEFAULT_STATE: ListsState = {
  kind: 'default',
  lists: [
    { id: 1, name: 'Groceries', createdAtMs: 0 },
    { id: 2, name: 'Inbox', createdAtMs: 0 },
  ],
};

describe('ListsScreen', () => {
  it('shows every list in the default state', async () => {
    await renderWithProviders(<ListsScreen model={modelWith(DEFAULT_STATE)} />);

    for (const testID of [
      'lists.screen',
      'lists.list',
      'lists.list-row.1',
      'lists.list-row.2',
      'lists.list-row.1.delete-button',
    ]) {
      expect(screen.getByTestId(testID, HIDDEN)).toBeOnTheScreen();
    }
    expect(screen.getByText('Groceries')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete Groceries' })).toBeOnTheScreen();
    expect(screen.queryByTestId('lists.empty-title', HIDDEN)).not.toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows the empty state with a header and one line', async () => {
    await renderWithProviders(<ListsScreen model={modelWith({ kind: 'empty' })} />);

    for (const testID of ['lists.screen', 'lists.empty-title', 'lists.empty-body']) {
      expect(screen.getByTestId(testID, HIDDEN)).toBeOnTheScreen();
    }
    expect(screen.getByRole('header', { name: 'No lists yet' })).toBeOnTheScreen();
    expect(screen.queryByTestId('lists.list', HIDDEN)).not.toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows the error state with its message and the retry button', async () => {
    await renderWithProviders(
      <ListsScreen model={modelWith({ kind: 'error', failure: { kind: 'storage-busy' } })} />,
    );

    for (const testID of ['lists.screen', 'lists.error-note', 'lists.retry-button']) {
      expect(screen.getByTestId(testID, HIDDEN)).toBeOnTheScreen();
    }
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('retries from the error state when the button is pressed', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    await renderWithProviders(
      <ListsScreen
        model={modelWith({ kind: 'error', failure: { kind: 'storage-busy' } }, { onRetry })}
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('asks to delete the pressed list by its id', async () => {
    const user = userEvent.setup();
    const onAskDelete = jest.fn();
    await renderWithProviders(<ListsScreen model={modelWith(DEFAULT_STATE, { onAskDelete })} />);

    await user.press(screen.getByRole('button', { name: 'Delete Inbox' }));

    expect(onAskDelete).toHaveBeenCalledWith(2);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows the delete dialog while a delete is pending', async () => {
    await renderWithProviders(
      <ListsScreen model={modelWith(DEFAULT_STATE, { deleteDialog: DIALOG })} />,
    );

    expect(screen.getByTestId('delete-list-dialog.card', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Delete Groceries?' })).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
