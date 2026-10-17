// src/ui/app-bar.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { AppBar } from './app-bar';

describe('AppBar', () => {
  it('names the screen with a header and goes back with a named button', async () => {
    const onBack = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <AppBar
        title="Settings"
        testID="settings.app-bar"
        isReducedMotion
        back={{ label: 'Back', onPress: onBack, icon: () => null }}
      />,
    );

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    expect(screen.getByTestId('settings.app-bar.title')).toHaveTextContent('Settings');
    await user.press(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings.app-bar.back-button')).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('has no back button on a top-level screen', async () => {
    await renderWithProviders(<AppBar title="Tasks" testID="tasks.app-bar" isReducedMotion />);

    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });
});
