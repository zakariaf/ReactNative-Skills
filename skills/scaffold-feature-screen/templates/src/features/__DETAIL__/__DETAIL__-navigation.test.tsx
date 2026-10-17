// src/features/__DETAIL__/__DETAIL__-navigation.test.tsx
// The route test: the real route file in Expo Router's in-memory router, opened by a URL as a deep
// link would, so route -> params -> model hook -> view runs once as on a device. Route tests live in
// the feature, never in src/app (architecture-and-boundaries).
import { screen, userEvent } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';

import __DETAIL_PASCAL__Route from '@/app/__DETAIL_ROUTE_ID__';
import { I18nProvider } from '@/i18n/i18n-provider';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

function TestLayout(): ReactNode {
  return (
    <I18nProvider language="en" digits="automatic" onError={failOnError}>
      <Stack screenOptions={{ headerShown: false }} />
    </I18nProvider>
  );
}

function HomeStandIn(): ReactNode {
  return <AppText>Home</AppText>;
}

const ROUTES = {
  _layout: TestLayout,
  index: HomeStandIn,
  '__DETAIL_ROUTE_ID__': __DETAIL_PASCAL__Route,
};

describe('__DETAIL_PASCAL__Route', () => {
  it('opens from a link with a valid id', async () => {
    const view = await renderRouterWithProviders(ROUTES, {
      initialUrl: '__DETAIL_HREF_BASE__/item-7',
    });

    expect(view.getPathname()).toBe('__DETAIL_HREF_BASE__/item-7');
    expect(screen.getByTestId('__DETAIL__.body')).toHaveTextContent('__DETAIL_BODY__');
  });

  it('leaves a dead link for the first screen with nothing to go back to', async () => {
    const user = userEvent.setup();
    const view = await renderRouterWithProviders(ROUTES, {
      initialUrl: '__DETAIL_HREF_BASE__/Not%20An%20Id',
    });

    await user.press(screen.getByRole('button', { name: 'Go to the first screen' }));

    expect(await screen.findByText('Home')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
    expect(router.canGoBack()).toBe(false);
  });
});
