// src/features/__FEATURE__/__FEATURE__-navigation.test.tsx
// The route test: the real route file in Expo Router's in-memory router (never a mocked router), so
// the whole chain route -> model hook -> view runs once, as on a device. Route tests live in the
// feature, never in src/app (architecture-and-boundaries).
import { screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';

import __FEATURE_PASCAL__Route from '@/app/__ROUTE_ID__';
import { I18nProvider } from '@/i18n/i18n-provider';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

/** The app's I18nProvider (the source catalog) around a plain stack. */
function TestLayout(): ReactNode {
  return (
    <I18nProvider language="en" digits="automatic" onError={failOnError}>
      <Stack />
    </I18nProvider>
  );
}

const ROUTES = {
  _layout: TestLayout,
  '__ROUTE_ID__': __FEATURE_PASCAL__Route,
};

describe('__FEATURE_PASCAL__Route', () => {
  it('opens at its URL and renders the screen with the model', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '__ROUTE_HREF__' });

    expect(view.getPathname()).toBe('__ROUTE_HREF__');
    expect(screen.getByTestId('__FEATURE__.body')).toHaveTextContent('__BODY__');
  });
});
