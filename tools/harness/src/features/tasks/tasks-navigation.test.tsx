// src/features/tasks/tasks-navigation.test.tsx
// The route test of the home route: the real route file in Expo Router's in-memory router (never a
// mocked router), so route -> model hook -> view runs once, as on a device. It lives in the feature,
// never in src/app (architecture-and-boundaries).
import { screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';

import TasksRoute from '@/app/(app)/index';
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
  '(app)/index': TasksRoute,
};

describe('TasksRoute', () => {
  it('opens at the home URL and renders the screen with the model', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/' });

    expect(view.getPathname()).toBe('/');
    expect(screen.getByTestId('tasks.summary')).toHaveTextContent('2 open tasks');
  });
});
