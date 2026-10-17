// src/ui/text-button.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { COMPONENT_SPECS } from './component-specs';
import { TextButton } from './text-button';

describe('TextButton', () => {
  it('is a named button that reports presses', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <TextButton
        label="Not now"
        onPress={onPress}
        testID="reminder.later-button"
        isReducedMotion
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Not now' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('draws its underline as a bar in the label colour, never textDecorationLine', async () => {
    await renderWithProviders(
      <TextButton
        label="Remove"
        tone="danger"
        onPress={jest.fn()}
        testID="task.remove-button"
        isReducedMotion
      />,
    );

    expect(screen.getByTestId('task.remove-button.label')).not.toHaveStyle({
      textDecorationLine: 'underline',
    });
    expect(screen.getByTestId('task.remove-button.underline')).toHaveStyle({
      height: COMPONENT_SPECS.textButton.underlineThickness,
      backgroundColor: PALETTE.light.danger,
    });
  });

  it('mutes the label and the bar when disabled', async () => {
    await renderWithProviders(
      <TextButton
        label="Undo"
        onPress={jest.fn()}
        testID="tasks.undo-button"
        isDisabled
        isReducedMotion
      />,
    );

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByTestId('tasks.undo-button.underline')).toHaveStyle({
      backgroundColor: PALETTE.light.textMuted,
    });
  });
});
