// src/ui/feedback/confirm-dialog.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { ConfirmDialog } from './confirm-dialog';

import type { ConfirmRequest } from './confirm';

const CLEAR_DONE: ConfirmRequest = {
  title: 'Delete 3 done tasks?',
  body: 'They are removed for good.',
  confirmLabel: 'Delete tasks',
  cancelLabel: 'Cancel',
  tone: 'destructive',
  testID: 'tasks.clear-done-dialog',
};

describe('ConfirmDialog', () => {
  it('renders nothing while no question is open', async () => {
    await renderWithProviders(
      <ConfirmDialog testID="app.confirm" request={null} onAnswer={jest.fn()} isReducedMotion />,
    );
    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
  });

  it('names the consequence, offers Cancel first and answers with the pressed button', async () => {
    const onAnswer = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ConfirmDialog
        testID="app.confirm"
        request={CLEAR_DONE}
        onAnswer={onAnswer}
        isReducedMotion={false}
      />,
    );
    expect(screen.getByRole('header', { name: 'Delete 3 done tasks?' })).toBeOnTheScreen();
    expect(screen.getByTestId('tasks.clear-done-dialog.title')).toHaveTextContent(
      'Delete 3 done tasks?',
    );
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('Cancel');
    expect(second).toHaveAccessibleName('Delete tasks');
    await user.press(screen.getByRole('button', { name: 'Delete tasks' }));
    expect(onAnswer).toHaveBeenCalledWith('confirmed');
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAnswer).toHaveBeenLastCalledWith('cancelled');
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('opens in the overlay window on iOS, above modal screens, with screen readers kept inside', async () => {
    await renderWithProviders(
      <ConfirmDialog
        testID="app.confirm"
        request={CLEAR_DONE}
        onAnswer={jest.fn()}
        isReducedMotion
      />,
    );
    const scrim = screen.getByTestId('app.confirm');
    expect(scrim).toHaveProp('accessibilityViewIsModal', true);
    expect(screen.getByTestId('tasks.clear-done-dialog')).toBeOnTheScreen();
    const overlays = screen.container.queryAll((node) => node.type === 'RNSFullWindowOverlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toHaveProp('accessibilityContainerViewIsModal', true);
    expect(scrim.parent).toBe(overlays[0]);
  });
});
