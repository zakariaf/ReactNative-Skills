// src/ui/segmented-control.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { SegmentedControl } from './segmented-control';

type ThemeChoice = 'system' | 'light' | 'dark';

const HIDDEN = { includeHiddenElements: true } as const;

const SEGMENTS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

describe('SegmentedControl', () => {
  it('names its radio group and selects one radio per value', async () => {
    await renderWithProviders(
      <SegmentedControl<ThemeChoice>
        segments={SEGMENTS}
        selected="dark"
        onSelect={jest.fn()}
        label="Theme"
        testID="settings.theme-control"
        isReducedMotion
      />,
    );

    // The group is not one accessibility element (its radios stay reachable): it carries the role.
    const group = screen.getByTestId('settings.theme-control');
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(group).toHaveProp('accessibilityLabel', 'Theme');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeSelected();
    expect(screen.getByRole('radio', { name: 'Light' })).not.toBeSelected();
    expect(screen.getByTestId('settings.theme-control.dark.label')).toHaveTextContent('Dark');
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('marks only the chosen segment with a check, not only a fill', async () => {
    await renderWithProviders(
      <SegmentedControl<ThemeChoice>
        segments={SEGMENTS}
        selected="light"
        onSelect={jest.fn()}
        label="Theme"
        testID="settings.theme-control"
        isReducedMotion
      />,
    );

    expect(screen.getByTestId('settings.theme-control.light.check', HIDDEN)).toBeOnTheScreen();
    expect(
      screen.queryByTestId('settings.theme-control.system.check', HIDDEN),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('settings.theme-control.dark.check', HIDDEN)).not.toBeOnTheScreen();
  });

  it('reports the value of the pressed segment', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <SegmentedControl<ThemeChoice>
        segments={SEGMENTS}
        selected="system"
        onSelect={onSelect}
        label="Theme"
        testID="settings.theme-control"
        isReducedMotion
      />,
    );

    await user.press(screen.getByTestId('settings.theme-control.light'));

    expect(onSelect).toHaveBeenCalledWith('light');
  });
});
