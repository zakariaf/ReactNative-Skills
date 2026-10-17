// src/ui/radio-mark.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { RadioMark } from './radio-mark';

const HIDDEN = { includeHiddenElements: true } as const;

describe('RadioMark', () => {
  it('hides itself and marks the chosen option with a dot, not only the ring colour', async () => {
    await renderWithProviders(<RadioMark isSelected testID="sort.by-date-row.radio" />);

    const ring = screen.getByTestId('sort.by-date-row.radio', HIDDEN);
    expect(ring).toHaveStyle({ borderColor: PALETTE.light.primary });
    expect(screen.getByTestId('sort.by-date-row.radio.dot', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByTestId('sort.by-date-row.radio')).not.toBeOnTheScreen();
  });

  it('stays an empty ring when not chosen', async () => {
    await renderWithProviders(<RadioMark isSelected={false} testID="sort.by-name-row.radio" />);

    expect(screen.getByTestId('sort.by-name-row.radio', HIDDEN)).toHaveStyle({
      borderColor: PALETTE.light.border,
    });
    expect(screen.queryByTestId('sort.by-name-row.radio.dot', HIDDEN)).not.toBeOnTheScreen();
  });
});
