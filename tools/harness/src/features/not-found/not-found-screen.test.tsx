// src/features/not-found/not-found-screen.test.tsx
// The view test of the not-found screen: a pure view of its props, so it renders with plain strings.
// It finds every testID of the screen (the screen contract lists them when the app keeps one), fires
// its one handler, and audits the pressables.
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { NotFoundScreen } from './not-found-screen';

async function renderNotFound(onGoHome: () => void = jest.fn()): Promise<void> {
  await renderWithProviders(
    <NotFoundScreen
      title="Page not found"
      body="This link doesn’t lead anywhere in the app."
      goHomeLabel="Go to your tasks"
      onGoHome={onGoHome}
      isReducedMotion={false}
    />,
  );
}

describe('NotFoundScreen', () => {
  it('shows the title as a header, the body and the way out', async () => {
    await renderNotFound();

    for (const testID of [
      'not-found.screen',
      'not-found.title',
      'not-found.body',
      'not-found.go-home-button',
    ]) {
      expect(screen.getByTestId(testID, { includeHiddenElements: true })).toBeOnTheScreen();
    }
    expect(screen.getByRole('header', { name: 'Page not found' })).toBeOnTheScreen();
    expect(screen.getByText('This link doesn’t lead anywhere in the app.')).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('goes home when the button is pressed', async () => {
    const user = userEvent.setup();
    const onGoHome = jest.fn();
    await renderNotFound(onGoHome);

    await user.press(screen.getByRole('button', { name: 'Go to your tasks' }));

    expect(onGoHome).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
