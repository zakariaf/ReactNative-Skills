// src/ui/busy-indicator.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { BusyIndicator } from './busy-indicator';

const INK = PALETTE.light.text;

describe('BusyIndicator', () => {
  it('is a labelled, busy image when it stands alone', async () => {
    await renderWithProviders(
      <BusyIndicator color={INK} label="Loading" isReducedMotion testID="tasks.loading" />,
    );

    const image = screen.getByRole('image', { name: 'Loading' });
    expect(image).toBeBusy();
  });

  it('hides itself inside a control that already says it is busy', async () => {
    await renderWithProviders(
      <BusyIndicator color={INK} isReducedMotion={false} testID="tasks.save-button.busy" />,
    );

    expect(screen.queryByRole('image')).not.toBeOnTheScreen();
    expect(
      screen.getByTestId('tasks.save-button.busy', { includeHiddenElements: true }),
    ).toHaveProp('importantForAccessibility', 'no-hide-descendants');
  });
});
