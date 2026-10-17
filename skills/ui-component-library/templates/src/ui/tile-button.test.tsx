// src/ui/tile-button.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { TileButton } from './tile-button';

describe('TileButton', () => {
  it('is a named button that reports presses', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <TileButton
        label="New list"
        icon={() => null}
        onPress={onPress}
        testID="home.new-list-button"
        isReducedMotion
      />,
    );

    await user.press(screen.getByRole('button', { name: 'New list' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('grows into its cell without a zero flex basis', async () => {
    await renderWithProviders(
      <TileButton
        label="Today"
        icon={() => null}
        onPress={jest.fn()}
        testID="home.today-button"
        isReducedMotion
      />,
    );

    const tile = screen.getByRole('button', { name: 'Today' });
    expect(tile).toHaveStyle({ flexGrow: 1 });
    expect(tile).not.toHaveStyle({ flex: 1 });
    expect(tile).not.toHaveStyle({ flexBasis: 0 });
  });
});
