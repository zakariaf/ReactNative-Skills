// src/ui/icon-button.test.tsx
import { screen, userEvent } from '@testing-library/react-native';
import { View } from 'react-native';

import { PALETTE } from '@/theme/palette';
import { MIN_TOUCH } from '@/theme/tokens';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { COMPONENT_SPECS } from './component-specs';
import { IconButton } from './icon-button';

import type { IconLook } from './icon-slot';
import type { ReactNode } from 'react';

const SPEC = COMPONENT_SPECS.iconButton;

function glyph(): ReactNode {
  return <View />;
}

describe('IconButton', () => {
  it('is named by its label, since an icon has no text to read', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <IconButton
        label="Settings"
        icon={glyph}
        onPress={onPress}
        testID="tasks.settings-button"
        isReducedMotion
      />,
    );

    await user.press(screen.getByRole('button', { name: 'Settings' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('keeps its own box at the touch minimum or above, even in the small size', () => {
    expect(SPEC.size).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(SPEC.sizeSmall).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  it('draws its icon muted when disabled', async () => {
    const icon = jest.fn((_look: IconLook): ReactNode => null);
    await renderWithProviders(
      <IconButton
        label="Share"
        icon={icon}
        onPress={jest.fn()}
        testID="task.share-button"
        isDisabled
        isReducedMotion
      />,
    );

    expect(icon).toHaveBeenCalledWith({ size: SPEC.icon, color: PALETTE.light.textMuted });
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
  });
});
