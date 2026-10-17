// src/features/not-found/not-found-navigation.test.tsx
// The route test of the not-found screen, and the pinned facts the navigation rules rest on
// (expo-router 57.0.24, re-run on every SDK upgrade): an unknown URL opens +not-found; its one way
// out leaves nothing to go back to; dismissTo returns to a screen already in the stack, while
// navigate and push stack a second copy of it.
import { act, screen, userEvent } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';

import NotFoundRoute from '@/app/+not-found';
import { I18nProvider } from '@/i18n/i18n-provider';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

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

function TaskStandIn(): ReactNode {
  return <AppText>One task</AppText>;
}

/**
 * Hrefs of the stand-in routes below. They are not the app's routes, so the generated typed routes
 * (experiments.typedRoutes) do not know them; app code never casts an href.
 */
const TASK_7 = '/tasks/7' as Href;
const TASK_8 = '/tasks/8' as Href;

const ROUTES = {
  _layout: TestLayout,
  index: TasksStandIn,
  'tasks/[taskId]': TaskStandIn,
  '+not-found': NotFoundRoute,
};

describe('NotFoundRoute', () => {
  it('opens for a URL that matches no route', async () => {
    await renderRouterWithProviders(ROUTES, { initialUrl: '/no-such-page' });

    expect(screen.getByRole('header', { name: 'Page not found' })).toBeOnTheScreen();
  });

  it('goes to the first screen and leaves nothing to go back to', async () => {
    const user = userEvent.setup();
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/no-such-page' });

    await user.press(screen.getByRole('button', { name: 'Go to your tasks' }));

    expect(await screen.findByText('Tasks')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
    expect(router.canGoBack()).toBe(false);
  });
});

describe('going back to a screen already in the stack', () => {
  it('returns to it with dismissTo', async () => {
    const view = await renderRouterWithProviders(ROUTES);
    await act(() => {
      router.push(TASK_7);
    });
    await act(() => {
      router.push(TASK_8);
    });

    await act(() => {
      router.dismissTo('/');
    });

    expect(view.getPathname()).toBe('/');
    expect(router.canGoBack()).toBe(false);
  });

  it('stacks a second copy with navigate', async () => {
    const view = await renderRouterWithProviders(ROUTES);
    await act(() => {
      router.push(TASK_7);
    });

    await act(() => {
      router.navigate('/');
    });

    expect(view.getPathname()).toBe('/');
    expect(router.canGoBack()).toBe(true);
  });
});
