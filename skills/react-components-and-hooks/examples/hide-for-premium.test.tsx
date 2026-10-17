// Example (shape only, never copied into the app): the Profiler re-render guard of
// hide-for-premium.tsx. It assumes the app's test/test-app.tsx creates the entitlement and tasks
// stores per render, seeds them from options and returns them in `stores` (state-management-zustand
// adds them when the app gains stores).
import { act, screen } from '@testing-library/react-native';
import { Profiler } from 'react';
import { View } from 'react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { HideForPremium } from './hide-for-premium';

const banner = <View testID="tasks.upgrade-banner" />;

describe('HideForPremium', () => {
  it('does not re-render when an unrelated store changes', async () => {
    const onRender = jest.fn();
    const { stores } = await renderWithProviders(
      <Profiler id="hide-for-premium" onRender={onRender}>
        <HideForPremium>{banner}</HideForPremium>
      </Profiler>,
    );
    const rendersAfterMount = onRender.mock.calls.length;

    await act(() => {
      stores.tasks.getState().setFilter('open');
    });

    expect(onRender).toHaveBeenCalledTimes(rendersAfterMount);
  });

  it('removes its children as soon as Premium is granted', async () => {
    const { stores } = await renderWithProviders(<HideForPremium>{banner}</HideForPremium>);
    expect(screen.getByTestId('tasks.upgrade-banner')).toBeOnTheScreen();
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);

    await act(() => {
      stores.entitlement.getState().grantPremium();
    });

    expect(screen.queryByTestId('tasks.upgrade-banner')).not.toBeOnTheScreen();
  });

  it('renders nothing when the saved entitlement already holds Premium', async () => {
    await renderWithProviders(<HideForPremium>{banner}</HideForPremium>, {
      entitlement: { isPremium: true },
    });
    expect(screen.queryByTestId('tasks.upgrade-banner')).not.toBeOnTheScreen();
  });
});
