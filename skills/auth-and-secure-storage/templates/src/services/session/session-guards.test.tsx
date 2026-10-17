// src/services/session/session-guards.test.tsx
// The guards on Expo Router's Stack.Protected, in the in-memory router: only the checking-session
// route is open while the session is unknown (never a blank frame), a deep link into the signed-in
// group lands on sign-in while signed out and on its target when the restore finished first (the
// startup gate's blocking task), signing in opens the group, and signing out closes it again and
// drops its history.
import { act, screen } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { AppState, View } from 'react-native';

import { renderRouterWithProviders } from '@test/render-router-with-providers';
import { createSessionTestKit, TEST_ACCOUNT } from '@test/session/session-test-kit';

import { SessionProvider, useSessionSnapshot } from './session-context';
import { sessionGuards } from './session-guards';

import type { SessionManager } from './session-types';
import type { ReactNode } from 'react';

function RootStack(): ReactNode {
  const guards = sessionGuards(useSessionSnapshot());
  // Never null: while the session is unknown only the checking-session route is open.
  return (
    <Stack>
      <Stack.Protected guard={guards.isRestoring}>
        <Stack.Screen name="checking-session" />
      </Stack.Protected>
      <Stack.Protected guard={guards.isSignedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={guards.isSignedOut}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

function TasksRoute(): ReactNode {
  return <View testID="tasks.screen" />;
}

function TaskDetailRoute(): ReactNode {
  return <View testID="task-detail.screen" />;
}

function SignInRoute(): ReactNode {
  return <View testID="sign-in.screen" />;
}

function CheckingSessionRoute(): ReactNode {
  return <View testID="checking-session.screen" />;
}

/** The group's own layout: without it "(app)" is not one route, and the guard protects nothing. */
function AppGroupLayout(): ReactNode {
  return <Stack />;
}

function routesFor(session: SessionManager, { hasGroupLayout = true } = {}) {
  function RootLayout(): ReactNode {
    return (
      <SessionProvider session={session}>
        <RootStack />
      </SessionProvider>
    );
  }
  const groupLayout = hasGroupLayout ? { '(app)/_layout': AppGroupLayout } : {};
  return {
    _layout: RootLayout,
    ...groupLayout,
    '(app)/index': TasksRoute,
    '(app)/tasks/[id]': TaskDetailRoute,
    'checking-session': CheckingSessionRoute,
    'sign-in': SignInRoute,
  };
}

describe('sessionGuards', () => {
  it('opens no group while restoring or locked, one group otherwise', () => {
    expect(
      [
        { status: 'restoring' } as const,
        { status: 'unavailable' } as const,
        { status: 'signed-in', account: TEST_ACCOUNT } as const,
        { status: 'signed-out', reason: null } as const,
      ].map(sessionGuards),
    ).toStrictEqual([
      { isRestoring: true, isSignedIn: false, isSignedOut: false },
      { isRestoring: true, isSignedIn: false, isSignedOut: false },
      { isRestoring: false, isSignedIn: true, isSignedOut: false },
      { isRestoring: false, isSignedIn: false, isSignedOut: true },
    ]);
  });
});

describe('protected route groups', () => {
  it('sends a deep link into the app to sign-in while signed out', async () => {
    const { session } = createSessionTestKit();

    const view = await renderRouterWithProviders(routesFor(session), { initialUrl: '/tasks/7' });

    expect(await screen.findByTestId('sign-in.screen')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/sign-in');
    expect(screen.queryByTestId('task-detail.screen')).not.toBeOnTheScreen();
  });

  it('opens the app after sign-in and closes it after sign-out', async () => {
    const { session } = createSessionTestKit();
    const view = await renderRouterWithProviders(routesFor(session));
    await screen.findByTestId('sign-in.screen');

    await act(async () => {
      await session.signIn({
        grant: { accessToken: 'a', refreshToken: 'r' },
        account: TEST_ACCOUNT,
      });
    });
    expect(await screen.findByTestId('tasks.screen')).toBeOnTheScreen();
    await act(() => {
      router.push('/tasks/7');
    });
    await screen.findByTestId('task-detail.screen');
    await act(async () => {
      await session.signOut('user');
    });

    expect(await screen.findByTestId('sign-in.screen')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/sign-in');
    expect(router.canGoBack()).toBe(false);
  });

  it('protects nothing when the group has no layout of its own (the pitfall the checker catches)', async () => {
    const { session } = createSessionTestKit();

    await renderRouterWithProviders(routesFor(session, { hasGroupLayout: false }), {
      initialUrl: '/tasks/7',
    });

    expect(await screen.findByTestId('task-detail.screen')).toBeOnTheScreen();
  });

  it('opens the signed-in group straight away for a stored session', async () => {
    const { session } = createSessionTestKit({ isSignedIn: true });

    await renderRouterWithProviders(routesFor(session));

    expect(await screen.findByTestId('tasks.screen')).toBeOnTheScreen();
  });

  it('keeps a deep link into the group when the restore finished before the stack mounted', async () => {
    const { session } = createSessionTestKit({ isSignedIn: true });
    // What the startup gate's blocking task does before the splash goes.
    await session.restore();

    const view = await renderRouterWithProviders(routesFor(session), { initialUrl: '/tasks/7' });

    expect(await screen.findByTestId('task-detail.screen')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/tasks/7');
  });

  it('shows the checking-session route while the keychain is locked', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    const { session, secureStorage } = createSessionTestKit({ isSignedIn: true });
    secureStorage.failNext('read');

    const view = await renderRouterWithProviders(routesFor(session), { initialUrl: '/tasks/7' });

    expect(await screen.findByTestId('checking-session.screen')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/checking-session');
    expect(screen.queryByTestId('task-detail.screen')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('sign-in.screen')).not.toBeOnTheScreen();
  });
});
