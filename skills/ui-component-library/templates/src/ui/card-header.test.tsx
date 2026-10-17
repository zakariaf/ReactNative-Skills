// src/ui/card-header.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { CardHeader } from './card-header';

describe('CardHeader', () => {
  it('makes the title a header with a derived id', async () => {
    await renderWithProviders(<CardHeader title="This week" testID="stats.week-card.header" />);

    expect(screen.getByRole('header', { name: 'This week' })).toBeOnTheScreen();
    expect(screen.getByTestId('stats.week-card.header.title')).toHaveTextContent('This week');
  });
});
