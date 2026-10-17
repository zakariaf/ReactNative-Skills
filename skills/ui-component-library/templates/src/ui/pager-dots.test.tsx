// src/ui/pager-dots.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { COMPONENT_SPECS } from './component-specs';
import { PagerDots } from './pager-dots';

const HIDDEN = { includeHiddenElements: true } as const;

describe('PagerDots', () => {
  it('keys each dot by its page and widens the current one', async () => {
    await renderWithProviders(
      <PagerDots
        pages={['welcome', 'lists', 'reminders']}
        current="lists"
        testID="onboarding.pager-dots"
      />,
    );

    expect(screen.queryByTestId('onboarding.pager-dots')).not.toBeOnTheScreen();
    expect(screen.getByTestId('onboarding.pager-dots.lists', HIDDEN)).toHaveStyle({
      width: COMPONENT_SPECS.pagerDots.activeWidth,
      backgroundColor: PALETTE.light.primary,
    });
    expect(screen.getByTestId('onboarding.pager-dots.welcome', HIDDEN)).toHaveStyle({
      width: COMPONENT_SPECS.pagerDots.dot,
    });
  });
});
