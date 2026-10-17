// src/ui/progress-bar.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('is a labelled progress bar with its value and a fill from the start edge', async () => {
    await renderWithProviders(
      <ProgressBar value={3 / 8} label="3 of 8 tasks done" testID="today.progress" />,
    );

    const bar = screen.getByRole('progressbar', { name: '3 of 8 tasks done' });
    expect(bar).toHaveAccessibilityValue({ min: 0, max: 100, now: 38 });
    expect(screen.getByTestId('today.progress.fill')).toHaveStyle({ width: '37.5%' });
  });

  it('keeps the fill inside the track for out-of-range values', async () => {
    await renderWithProviders(<ProgressBar value={1.4} label="All done" testID="today.progress" />);

    expect(screen.getByTestId('today.progress.fill')).toHaveStyle({ width: '100%' });
  });
});
