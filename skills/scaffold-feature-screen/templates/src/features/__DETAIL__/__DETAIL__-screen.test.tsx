// src/features/__DETAIL__/__DETAIL__-screen.test.tsx
// The view test: one block per state, named for it, each naming the state's testIDs and ending with
// the pressable audit (accessibility-as-code). The screen is a pure view, so plain values suffice.
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { __DETAIL_PASCAL__Screen } from './__DETAIL__-screen';

import type { __DETAIL_PASCAL__Model, __DETAIL_PASCAL__State } from './use-__DETAIL__-model';

function modelWith(
  state: __DETAIL_PASCAL__State,
  onGoHome: () => void = jest.fn(),
): __DETAIL_PASCAL__Model {
  return {
    title: 'Screen title',
    state,
    body: 'Screen body',
    invalidLinkText: 'This link opens nothing.',
    goHomeLabel: 'Go home',
    onGoHome,
    isReducedMotion: false,
  };
}

describe('__DETAIL_PASCAL__Screen', () => {
  it('shows the body in the default state', async () => {
    await renderWithProviders(
      <__DETAIL_PASCAL__Screen model={modelWith({ kind: 'ready', __PARAM__: 'item-7' })} />,
    );

    expect(screen.getByTestId('__DETAIL__.screen')).toBeOnTheScreen();
    expect(screen.getByTestId('__DETAIL__.body')).toHaveTextContent('Screen body');
    expect(screen.queryByTestId('__DETAIL__.go-home-button')).not.toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows why and the way out in the invalid-link state', async () => {
    await renderWithProviders(<__DETAIL_PASCAL__Screen model={modelWith({ kind: 'invalid-link' })} />);

    expect(screen.getByTestId('__DETAIL__.invalid-link-text')).toHaveTextContent(
      'This link opens nothing.',
    );
    expect(screen.getByRole('button', { name: 'Go home' })).toBeOnTheScreen();
    expect(screen.getByTestId('__DETAIL__.go-home-button')).toBeOnTheScreen();
    expect(screen.queryByTestId('__DETAIL__.body')).not.toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('goes home when the way out is pressed in the invalid-link state', async () => {
    const user = userEvent.setup();
    const onGoHome = jest.fn();
    await renderWithProviders(
      <__DETAIL_PASCAL__Screen model={modelWith({ kind: 'invalid-link' }, onGoHome)} />,
    );

    await user.press(screen.getByRole('button', { name: 'Go home' }));

    expect(onGoHome).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
