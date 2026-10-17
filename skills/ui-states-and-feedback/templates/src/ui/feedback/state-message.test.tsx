// src/ui/feedback/state-message.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { StateMessage } from './state-message';

describe('StateMessage', () => {
  it('reads the title as a header and offers its one action', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <StateMessage
        testID="tasks.state.failed"
        title="Couldn't load your tasks"
        body="Check your connection and try again."
        action={{ label: 'Try again', onPress }}
        isReducedMotion={false}
      />,
    );
    expect(screen.getByRole('header', { name: "Couldn't load your tasks" })).toBeOnTheScreen();
    expect(screen.getByTestId('tasks.state.failed.body')).toHaveTextContent(
      'Check your connection and try again.',
    );
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows no button when the state resumes by itself', async () => {
    await renderWithProviders(
      <StateMessage
        testID="tasks.state.offline"
        title="You're offline"
        body="Your tasks load when you're back online."
        isReducedMotion
      />,
    );
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    expect(screen.getByTestId('tasks.state.offline.title')).toHaveTextContent("You're offline");
  });
});
