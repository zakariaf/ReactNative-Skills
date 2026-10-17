// src/ui/chip.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Chip } from './chip';

describe('Chip', () => {
  it('is one text element on its measured box, hugging its text', async () => {
    await renderWithProviders(<Chip text="Work" testID="task.list-chip" />);

    const chip = screen.getByTestId('task.list-chip');
    expect(chip).toHaveProp('accessible', true);
    expect(chip).toHaveProp('accessibilityRole', 'text');
    expect(chip).toHaveAccessibleName('Work');
    expect(chip).toHaveStyle({ alignSelf: 'flex-start' });
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });
});
