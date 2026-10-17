// src/ui/list-row.test.tsx
import { screen, userEvent } from '@testing-library/react-native';
import { View } from 'react-native';

import { PALETTE } from '@/theme/palette';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { COMPONENT_SPECS } from './component-specs';
import { ListRow } from './list-row';

const HIDDEN = { includeHiddenElements: true } as const;

describe('ListRow', () => {
  it('is a switch with its state when it switches a setting', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ListRow
        kind="switch"
        label="Daily reminder"
        isOn
        onPress={onPress}
        testID="settings.daily-reminder-switch"
        isReducedMotion
        isFirst
      />,
    );

    const row = screen.getByRole('switch', { name: 'Daily reminder' });
    expect(row).toBeChecked();
    expect(screen.getByTestId('settings.daily-reminder-switch.toggle', HIDDEN)).toBeOnTheScreen();
    await user.press(row);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('opens a page as a button, heard by the sentence the model gives it', async () => {
    await renderWithProviders(
      <ListRow
        kind="navigate"
        label="Language"
        value="English"
        a11yLabel="Language, English"
        onPress={jest.fn()}
        testID="settings.language-row"
        isReducedMotion
      />,
    );

    expect(screen.getByRole('button', { name: 'Language, English' })).toBeOnTheScreen();
    expect(screen.getByTestId('settings.language-row.value')).toHaveTextContent('English');
  });

  it('is a selected radio when it picks one of several', async () => {
    await renderWithProviders(
      <ListRow
        kind="radio"
        label="By due date"
        isSelected
        onPress={jest.fn()}
        testID="sort.by-date-row"
        isReducedMotion
      />,
    );

    expect(screen.getByRole('radio', { name: 'By due date' })).toBeSelected();
    expect(screen.getByTestId('sort.by-date-row.radio', HIDDEN)).toBeOnTheScreen();
  });

  it('shows a static row with a separator and derived parts', async () => {
    await renderWithProviders(
      <ListRow
        label="Delete all tasks"
        description="This cannot be undone"
        icon={() => <View />}
        isDanger
        testID="settings.erase-row"
        isReducedMotion
      />,
    );

    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    expect(screen.getByTestId('settings.erase-row')).toHaveStyle({
      borderTopWidth: COMPONENT_SPECS.row.separator,
    });
    expect(screen.getByTestId('settings.erase-row.description')).toHaveTextContent(
      'This cannot be undone',
    );
    expect(screen.getByTestId('settings.erase-row.icon', HIDDEN)).toHaveStyle({
      backgroundColor: PALETTE.light.dangerSurface,
    });
  });
});
