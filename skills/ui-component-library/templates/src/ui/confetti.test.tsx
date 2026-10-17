// src/ui/confetti.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Confetti } from './confetti';

const HIDDEN = { includeHiddenElements: true } as const;

describe('Confetti', () => {
  it('hides itself and scatters the same way in every language', async () => {
    await renderWithProviders(
      <Confetti isReducedMotion={false} testID="today.all-done-confetti" />,
    );

    const band = screen.getByTestId('today.all-done-confetti', HIDDEN);
    expect(band).toHaveStyle({ direction: 'ltr' });
    expect(screen.queryByTestId('today.all-done-confetti')).not.toBeOnTheScreen();
  });

  it('renders nothing under reduce motion', async () => {
    await renderWithProviders(<Confetti isReducedMotion testID="today.all-done-confetti" />);

    expect(screen.queryByTestId('today.all-done-confetti', HIDDEN)).not.toBeOnTheScreen();
  });
});
