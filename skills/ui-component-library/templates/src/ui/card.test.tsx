// src/ui/card.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { AppText } from './app-text';
import { Card } from './card';

describe('Card', () => {
  it('groups its content on a flat surface, with no shadow', async () => {
    await renderWithProviders(
      <Card testID="today.summary-card">
        <AppText>3 tasks left</AppText>
      </Card>,
    );

    const card = screen.getByTestId('today.summary-card');
    expect(card).toHaveStyle({ backgroundColor: PALETTE.light.surface });
    expect(card).toHaveStyle({ borderColor: PALETTE.light.separator });
    expect(screen.getByText('3 tasks left')).toBeOnTheScreen();
  });

  it('tints an error with the danger edge and surface', async () => {
    await renderWithProviders(
      <Card testID="sync.error-card" tone="danger">
        <AppText>Sync failed</AppText>
      </Card>,
    );

    expect(screen.getByTestId('sync.error-card')).toHaveStyle({
      borderColor: PALETTE.light.danger,
      backgroundColor: PALETTE.light.dangerSurface,
    });
  });
});
