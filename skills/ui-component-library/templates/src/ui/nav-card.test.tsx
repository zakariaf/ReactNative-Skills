// src/ui/nav-card.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { NavCard } from './nav-card';
import { PressFeedbackProvider } from './press-feedback-context';

describe('NavCard', () => {
  it('opens its page as one named button with derived parts, and plays the tap feedback', async () => {
    const onPress = jest.fn();
    const onFeedback = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <PressFeedbackProvider onPress={onFeedback}>
        <NavCard
          label="Archive"
          description="12 finished tasks"
          a11yLabel="Archive, 12 finished tasks"
          icon={() => null}
          onPress={onPress}
          testID="home.archive-card"
          isReducedMotion
        />
      </PressFeedbackProvider>,
    );

    await user.press(screen.getByRole('button', { name: 'Archive, 12 finished tasks' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onFeedback).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('home.archive-card.description')).toHaveTextContent(
      '12 finished tasks',
    );
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
