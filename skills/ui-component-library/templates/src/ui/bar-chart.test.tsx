// src/ui/bar-chart.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { BarChart } from './bar-chart';

const BARS = [
  { key: 'mon', value: 6, valueText: '6', label: 'Mon', a11yLabel: 'Monday: 6 tasks done' },
  { key: 'tue', value: 12, valueText: '12', label: 'Tue', a11yLabel: 'Tuesday: 12 tasks done' },
] as const;

describe('BarChart', () => {
  it('makes each column one labelled image keyed by its data', async () => {
    await renderWithProviders(<BarChart bars={BARS} max={12} testID="stats.week-chart" />);

    expect(screen.getByRole('image', { name: 'Monday: 6 tasks done' })).toHaveProp(
      'testID',
      'stats.week-chart.mon',
    );
    expect(screen.getByTestId('stats.week-chart.mon.bar')).toHaveStyle({ height: '50%' });
    expect(screen.getByTestId('stats.week-chart.tue.bar')).toHaveStyle({ height: '100%' });
  });
});
