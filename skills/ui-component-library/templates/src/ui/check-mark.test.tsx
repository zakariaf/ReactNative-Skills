// src/ui/check-mark.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { CheckMark } from './check-mark';

const HIDDEN = { includeHiddenElements: true } as const;

describe('CheckMark', () => {
  it('hides itself from screen readers and never mirrors', async () => {
    await renderWithProviders(<CheckMark color={PALETTE.light.primary} testID="task.done-mark" />, {
      language: 'en',
    });

    const mark = screen.getByTestId('task.done-mark', HIDDEN);
    expect(mark).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(mark).toHaveStyle({ direction: 'ltr' });
    expect(screen.queryByTestId('task.done-mark')).not.toBeOnTheScreen();
  });
});
