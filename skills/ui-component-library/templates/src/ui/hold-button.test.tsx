// src/ui/hold-button.test.tsx
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { HoldButton } from './hold-button';

describe('HoldButton', () => {
  it('ignores a short tap', async () => {
    const onConfirm = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <HoldButton
        label="Hold to delete all tasks"
        hint="Hold for 2 seconds"
        onConfirm={onConfirm}
        testID="erase-dialog.confirm-button"
        isReducedMotion
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Hold to delete all tasks' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('confirms through the activate action for screen-reader users', async () => {
    const onConfirm = jest.fn();
    await renderWithProviders(
      <HoldButton
        label="Hold to delete all tasks"
        hint="Hold for 2 seconds"
        onConfirm={onConfirm}
        testID="erase-dialog.confirm-button"
        isReducedMotion={false}
      />,
    );

    await fireEvent(screen.getByRole('button'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('measures the fill against the whole face, in a track pinned to its edges', async () => {
    await renderWithProviders(
      <HoldButton
        label="Hold to delete all tasks"
        hint="Hold for 2 seconds"
        onConfirm={jest.fn()}
        testID="erase-dialog.confirm-button"
        isReducedMotion
        frozenProgress={0.4}
      />,
    );

    expect(screen.getByTestId('erase-dialog.confirm-button.fill')).toHaveStyle({ width: '40%' });
  });
});
