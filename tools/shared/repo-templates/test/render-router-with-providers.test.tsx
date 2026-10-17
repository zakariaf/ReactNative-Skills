// test/render-router-with-providers.test.tsx — the router helper's own test, and the model for a
// route test: open a deep link, press a Link, navigate from outside React inside act(), and read the
// pathname, segments and params from the returned getters.
import { act, screen, userEvent } from '@testing-library/react-native';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { flushMicrotasks } from './flush-microtasks';
import { renderRouterWithProviders } from './render-router-with-providers';

import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

// Stand-in routes are not the app's routes: with typed routes generated (npx expo customize
// tsconfig.json), a literal href the app does not have fails tsc. Name each stand-in href once.
const TASK_7 = '/tasks/7' as Href;
const SIGN_IN = '/sign-in' as Href;

function TaskListRoute(): ReactNode {
  return <Link href={TASK_7}>Open task 7</Link>;
}

function TaskDetailRoute(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Text>{`Task ${id}`}</Text>;
}

function SignInRoute(): ReactNode {
  return <Text>Sign in</Text>;
}

const ROUTES = {
  index: TaskListRoute,
  'tasks/[id]': TaskDetailRoute,
  '(auth)/sign-in': SignInRoute,
};

describe('renderRouterWithProviders', () => {
  it('opens the first route and follows a link press', async () => {
    const user = userEvent.setup();
    const view = await renderRouterWithProviders(ROUTES);

    expect(view.getPathname()).toBe('/');

    await user.press(screen.getByRole('link', { name: 'Open task 7' }));

    expect(await screen.findByText('Task 7')).toBeOnTheScreen();
    expect(view.getSegments()).toStrictEqual(['tasks', '[id]']);
    expect(view.getSearchParams()).toStrictEqual({ id: '7' });
  });

  it('opens a deep link and navigates from outside React', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/tasks/3' });

    expect(screen.getByText('Task 3')).toBeOnTheScreen();

    await act(() => {
      router.replace(SIGN_IN);
    });

    expect(await screen.findByText('Sign in')).toBeOnTheScreen();
    expect(view.getSegments()).toStrictEqual(['(auth)', 'sign-in']);
  });

  it('leaves real timers on for the rest of the test', async () => {
    await renderRouterWithProviders(ROUTES);

    // Under fake timers setImmediate never fires and this would time out.
    await expect(flushMicrotasks()).resolves.toBeUndefined();
  });

  it('hands back the providers state, like renderWithProviders', async () => {
    const { queryClient } = await renderRouterWithProviders(ROUTES);

    expect(queryClient.getQueryCache().getAll()).toStrictEqual([]);
  });
});
