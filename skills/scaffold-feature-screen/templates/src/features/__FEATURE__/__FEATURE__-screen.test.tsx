// src/features/__FEATURE__/__FEATURE__-screen.test.tsx
// The view test: the screen is a pure view, so it renders with plain strings. It names every testID
// of the screen, and every block that renders ends with the pressable audit (accessibility-as-code).
import { screen } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { __FEATURE_PASCAL__Screen } from './__FEATURE__-screen';

import type { __FEATURE_PASCAL__Model } from './use-__FEATURE__-model';

const MODEL: __FEATURE_PASCAL__Model = { title: 'Screen title', body: 'Screen body' };

describe('__FEATURE_PASCAL__Screen', () => {
  it('shows the body it is given in the default state', async () => {
    await renderWithProviders(<__FEATURE_PASCAL__Screen model={MODEL} />);

    expect(screen.getByTestId('__FEATURE__.screen')).toBeOnTheScreen();
    expect(screen.getByTestId('__FEATURE__.body')).toHaveTextContent('Screen body');
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
