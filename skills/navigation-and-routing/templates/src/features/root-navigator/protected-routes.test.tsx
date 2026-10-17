// src/features/root-navigator/protected-routes.test.tsx
// Flows switch by guards, never by navigate(): a Stack.Protected group renders while its guard is
// true, and flipping the store value that feeds the guard moves the person by itself. These are the
// facts the navigation rules rest on (expo-router 57.0.24; re-run on every SDK upgrade): with the
// guard false the group's routes are out of reach (a deep link to one lands on the first screen
// that is in reach), and when the guard turns false while the person is inside the group, its
// screens leave the history. The guard here is a small stand-in store; the app's guards read its
// session or onboarding store the same way.
import { act, screen } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';
import { createStore, useStore } from 'zustand';

import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

type SessionState = { readonly isSignedIn: boolean };

const SIGNED_OUT: SessionState = { isSignedIn: false };

let session = createStore<SessionState>(() => SIGNED_OUT);

function setSignedIn(isSignedIn: boolean): void {
  session.setState({ isSignedIn });
}

function GuardedLayout(): ReactNode {
  const isSignedIn = useStore(session, (state) => state.isSignedIn);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

function GroupLayout(): ReactNode {
  return <Stack screenOptions={{ headerShown: false }} />;
}

function SignInStandIn(): ReactNode {
  return <AppText>Sign in</AppText>;
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

const ROUTES = {
  _layout: GuardedLayout,
  'sign-in': SignInStandIn,
  '(app)/_layout': GroupLayout,
  '(app)/index': TasksStandIn,
  '(app)/tasks/[taskId]': TaskStandIn,
};

describe('protected route groups', () => {
  beforeEach(() => {
    session = createStore<SessionState>(() => SIGNED_OUT);
  });

  it('opens the first screen in reach while the guard is false', async () => {
    await renderRouterWithProviders(ROUTES);

    expect(screen.getByText('Sign in')).toBeOnTheScreen();
  });

  it('keeps a deep link into the guarded group out of reach', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/tasks/7' });

    expect(screen.getByText('Sign in')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/sign-in');
  });

  it('moves the person in when the store flips the guard, without navigate', async () => {
    const view = await renderRouterWithProviders(ROUTES);

    await act(() => {
      setSignedIn(true);
    });

    expect(await screen.findByText('Tasks')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
  });

  it('drops the guarded screens from the history when the guard turns false', async () => {
    setSignedIn(true);
    const view = await renderRouterWithProviders(ROUTES);
    await act(() => {
      router.push(TASK_7);
    });

    await act(() => {
      setSignedIn(false);
    });

    expect(await screen.findByText('Sign in')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/sign-in');
    expect(router.canGoBack()).toBe(false);
  });
});
