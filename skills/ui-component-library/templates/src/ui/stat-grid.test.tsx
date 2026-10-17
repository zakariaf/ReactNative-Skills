// src/ui/stat-grid.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { StatGrid } from './stat-grid';

const STATS = [
  { id: 'done', value: '1,284', label: 'Tasks done' },
  { id: 'streak', value: '12', label: 'Day streak' },
  { id: 'lists', value: '4', label: 'Lists' },
] as const;

describe('StatGrid', () => {
  it('keys each cell by its stat and derives the value and label parts', async () => {
    await renderWithProviders(<StatGrid stats={STATS} testID="stats.overview" />);

    expect(screen.getByTestId('stats.overview.done.value')).toHaveTextContent('1,284');
    expect(screen.getByTestId('stats.overview.streak.label')).toHaveTextContent('Day streak');
    expect(screen.getByTestId('stats.overview.lists')).toHaveProp('accessible', true);
  });
});
