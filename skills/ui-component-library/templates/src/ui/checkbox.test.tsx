// src/ui/checkbox.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('is a named checkbox that reports its state and toggles', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <Checkbox
        label="Complete Buy milk"
        isChecked={false}
        onToggle={onToggle}
        testID="tasks.task-row.t1.complete-checkbox"
        isReducedMotion
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Complete Buy milk' });
    expect(checkbox).not.toBeChecked();
    await user.press(checkbox);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows a check, not only a colour, when checked', async () => {
    await renderWithProviders(
      <Checkbox
        label="Complete Pay rent"
        isChecked={false}
        onToggle={jest.fn()}
        testID="tasks.task-row.t3.complete-checkbox"
        isReducedMotion
      />,
    );
    expect(
      screen.queryByTestId('tasks.task-row.t3.complete-checkbox.check', {
        includeHiddenElements: true,
      }),
    ).not.toBeOnTheScreen();

    await renderWithProviders(
      <Checkbox
        label="Complete Call mum"
        isChecked
        onToggle={jest.fn()}
        testID="tasks.task-row.t2.complete-checkbox"
        isReducedMotion
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Complete Call mum' })).toBeChecked();
    expect(
      screen.getByTestId('tasks.task-row.t2.complete-checkbox.check', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
  });
});
