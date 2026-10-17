// src/ui/progress-bar.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('fills the share of finished tasks', async () => {
    await renderWithProviders(<ProgressBar done={1} total={4} />);

    expect(screen.getByTestId('progress-bar.fill')).toHaveStyle({ width: '25%' });
  });
});
