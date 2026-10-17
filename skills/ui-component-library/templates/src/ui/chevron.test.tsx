// src/ui/chevron.test.tsx
// no-providers: each case supplies the text locale (the layout direction) under test itself.
import { render, screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { TextLocaleProvider } from '@/theme/text-locale';

import { Chevron } from './chevron';

import type { TextDirection } from '@/theme/text-locale';

const HIDDEN = { includeHiddenElements: true } as const;

async function renderIn(direction: TextDirection): Promise<void> {
  await render(
    <TextLocaleProvider value={{ language: direction === 'rtl' ? 'ar' : 'en', direction }}>
      <Chevron color={PALETTE.light.textMuted} testID="row.chevron" />
    </TextLocaleProvider>,
  );
}

describe('Chevron', () => {
  it('points right in a left-to-right layout and hides itself', async () => {
    await renderIn('ltr');

    expect(screen.getByTestId('row.chevron', HIDDEN)).toHaveProp(
      'accessibilityElementsHidden',
      true,
    );
    expect(screen.getByTestId('row.chevron.mark', HIDDEN)).toHaveStyle({
      transform: [{ rotate: '45deg' }],
    });
  });

  it('points left in a right-to-left layout', async () => {
    await renderIn('rtl');

    expect(screen.getByTestId('row.chevron.mark', HIDDEN)).toHaveStyle({
      transform: [{ rotate: '-45deg' }],
    });
  });
});
