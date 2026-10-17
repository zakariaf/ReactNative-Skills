// src/features/not-found/use-not-found-model.test.tsx
// The not-found model inside a real router (expo-router's test renderer; the router is never mocked):
// its copy comes from the catalog, and when the first screen is already below the dead link, the way
// out returns to it instead of stacking a second copy (the cold-start case is in the route test).
import { act, screen, userEvent } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';

import { I18nProvider } from '@/i18n/i18n-provider';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { NotFoundScreen } from './not-found-screen';
import { useNotFoundModel } from './use-not-found-model';

import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

/** The app's I18nProvider (the en catalog) around a plain stack: the canonical test tree has no catalogs. */
function TestLayout(): ReactNode {
  return (
    <I18nProvider language="en" digits="automatic" onError={failOnError}>
      <Stack screenOptions={{ headerShown: false }} />
    </I18nProvider>
  );
}

function TasksStandIn(): ReactNode {
  return <AppText>Tasks</AppText>;
}

/** The model under test, rendered by the real screen, as the route file does. */
function NotFoundProbe(): ReactNode {
  const model = useNotFoundModel();
  return (
    <NotFoundScreen
      title={model.title}
      body={model.body}
      goHomeLabel={model.goHomeLabel}
      onGoHome={model.onGoHome}
      isReducedMotion={model.isReducedMotion}
    />
  );
}

/** A URL no route matches. Typed routes do not know it; app code never casts an href. */
const DEAD_LINK = '/no-such-page' as Href;

const ROUTES = {
  _layout: TestLayout,
  index: TasksStandIn,
  '+not-found': NotFoundProbe,
};

describe('useNotFoundModel', () => {
  it('reads its copy from the catalog', async () => {
    await renderRouterWithProviders(ROUTES, { initialUrl: '/no-such-page' });

    expect(screen.getByRole('header', { name: 'Page not found' })).toBeOnTheScreen();
    expect(
      screen.getByText('This link doesn’t lead anywhere in the app. It may be old or mistyped.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Go to your tasks' })).toBeOnTheScreen();
  });

  it('returns to the first screen below the dead link instead of stacking a copy', async () => {
    const user = userEvent.setup();
    const view = await renderRouterWithProviders(ROUTES);
    await act(() => {
      router.push(DEAD_LINK);
    });

    await user.press(screen.getByRole('button', { name: 'Go to your tasks' }));

    expect(await screen.findByText('Tasks')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
    expect(router.canGoBack()).toBe(false);
  });
});
