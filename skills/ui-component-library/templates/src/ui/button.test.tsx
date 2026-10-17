// src/ui/button.test.tsx
import { screen, userEvent } from '@testing-library/react-native';
import { View } from 'react-native';

import { PALETTE } from '@/theme/palette';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { Button } from './button';
import { COMPONENT_SPECS } from './component-specs';

import type { IconLook } from './icon-slot';
import type { ReactNode } from 'react';

const COLORS = PALETTE.light;

describe('Button', () => {
  it('is a named button that reports presses', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <Button
        label="Add task"
        onPress={onPress}
        testID="tasks.add-button"
        isReducedMotion={false}
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Add task' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('tasks.add-button.label')).toHaveTextContent('Add task');
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('asks its icon for the size and colour of its variant', async () => {
    const icon = jest.fn((_look: IconLook): ReactNode => null);
    await renderWithProviders(
      <Button
        label="Save"
        variant="primary"
        icon={icon}
        onPress={jest.fn()}
        testID="task-edit.save-button"
        isReducedMotion
      />,
    );

    expect(icon).toHaveBeenCalledWith({
      size: COMPONENT_SPECS.button.icon,
      color: COLORS.onPrimary,
    });
  });

  it('ignores presses while disabled or busy, and says so', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <View>
        <Button label="Save" onPress={onPress} testID="a.save-button" isDisabled isReducedMotion />
        <Button label="Saving" onPress={onPress} testID="b.save-button" isBusy isReducedMotion />
      </View>,
    );

    await user.press(screen.getByRole('button', { name: 'Save' }));
    await user.press(screen.getByRole('button', { name: 'Saving' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving' })).toBeBusy();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('grows from a basis when it shares a row, so two buttons wrap at large text', async () => {
    await renderWithProviders(
      <Button
        label="Cancel"
        onPress={jest.fn()}
        testID="dialog.cancel-button"
        isInRow
        isReducedMotion
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveStyle({
      flexGrow: 1,
      flexBasis: COMPONENT_SPECS.button.rowMinBasis,
    });
  });
});
