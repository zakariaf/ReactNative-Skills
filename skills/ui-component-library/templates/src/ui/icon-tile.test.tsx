// src/ui/icon-tile.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { COMPONENT_SPECS } from './component-specs';
import { IconTile } from './icon-tile';

import type { IconLook } from './icon-slot';
import type { ReactNode } from 'react';

const HIDDEN = { includeHiddenElements: true } as const;

describe('IconTile', () => {
  it('hides itself and paints the icon for its tile', async () => {
    const icon = jest.fn((_look: IconLook): ReactNode => null);
    await renderWithProviders(
      <IconTile icon={icon} paint="danger" testID="settings.erase-row.icon" />,
    );

    expect(screen.queryByTestId('settings.erase-row.icon')).not.toBeOnTheScreen();
    expect(screen.getByTestId('settings.erase-row.icon', HIDDEN)).toHaveStyle({
      backgroundColor: PALETTE.light.dangerSurface,
    });
    expect(icon).toHaveBeenCalledWith({
      size: COMPONENT_SPECS.iconTile.icon,
      color: PALETTE.light.danger,
    });
  });

  it('grows to the large size for a dialog or an empty state', async () => {
    await renderWithProviders(
      <IconTile icon={() => null} size="large" testID="tasks.empty-state.art" />,
    );

    expect(screen.getByTestId('tasks.empty-state.art', HIDDEN)).toHaveStyle({
      width: COMPONENT_SPECS.iconTile.sizeLarge,
    });
  });
});
