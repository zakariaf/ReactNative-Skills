// src/features/deep-links/deep-links-navigation.test.tsx
// The gate inside the real router (expo-router 57.0.24, re-run on every SDK upgrade). A route map
// with a '+native-intent' entry is what src/app/+native-intent.tsx is to the app: Expo Router calls
// its redirectSystemPath for the cold-start URL (renderRouter's initialUrl, a path) and for every
// 'url' event of expo-linking while it runs (a full URL; the testing library mocks expo-linking, so
// the test catches the router's listener). Pinned facts: a refused cold link lands on '/', a null
// answer to a warm link changes nothing, a kept query value with '&' arrives whole, and a gated link
// opens once from the first screen behind its gate, with Back returning to that screen.
import { act, screen } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';

import { useLinkGate } from '@/hooks/use-link-gate';
import { useOpenPendingLink } from '@/hooks/use-open-pending-link';
import { linkGates } from '@/services/deep-links/link-gates';
import { pendingLinks } from '@/services/deep-links/pending-link-inbox';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { createRedirectSystemPath } from './redirect-system-path';

import type { LinkPolicy } from '@/core/links/route-incoming-link';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

type UrlListener = (event: { readonly url: string }) => void;

/** Stand-in href of a stand-in route (typed routes know only the app's real files). */
const LIST_HREF = '/lists/l-1' as Href;

const POLICY: LinkPolicy<Href> = {
  schemes: ['tasks'],
  hosts: [],
  isTestBuild: false,
  routes: [
    { path: '/tasks/[taskId]', params: { taskId: 'slug' }, query: ['highlight'] },
    {
      path: '/lists/[listId]',
      params: { listId: 'slug' },
      gate: 'signed-in',
      open: () => LIST_HREF,
    },
  ],
};

const redirectSystemPath = createRedirectSystemPath({
  policy: () => POLICY,
  isGateOpen: (gate) => linkGates.isOpen(gate),
  defer: (link) => {
    pendingLinks.offer(link);
  },
  report: (error) => {
    throw error;
  },
});

function Layout(): ReactNode {
  return <Stack screenOptions={{ headerShown: false }} />;
}

/** The first screen behind the 'signed-in' gate: it owns the gate and opens a waiting link. */
function HomeStandIn(): ReactNode {
  useLinkGate('signed-in', true);
  useOpenPendingLink('signed-in');
  return <AppText>Home</AppText>;
}

function StandIn(): ReactNode {
  return <AppText>Stand-in</AppText>;
}

const ROUTES = {
  '+native-intent': { redirectSystemPath },
  _layout: Layout,
  index: HomeStandIn,
  'tasks/[taskId]': StandIn,
  'lists/[listId]': StandIn,
  'settings/delete-account': StandIn,
};

/**
 * The router subscribes to 'url' events through expo-linking once, at the first render of the file.
 * This mock records the listener on the module. expo-router is imported above the test helper (import
 * order), so the router loads this mock before expo-router's testing library registers its own.
 */
jest.mock('expo-linking', () => {
  const urlListeners: UrlListener[] = [];
  return {
    ...jest.requireActual<object>('expo-linking'),
    urlListeners,
    addEventListener: (_type: 'url', listener: UrlListener) => {
      urlListeners.push(listener);
      return { remove: () => undefined };
    },
  };
});

const linking = jest.requireMock<{ readonly urlListeners: readonly UrlListener[] }>('expo-linking');

/** Sends `url` as the OS would while the app runs. */
async function sendUrl(url: string): Promise<void> {
  // The router subscribes in an effect after its first render settles.
  await act(async () => {
    await Promise.resolve();
  });
  const listener = linking.urlListeners.at(-1);
  if (listener === undefined) throw new Error('the router did not subscribe to url events');
  await act(async () => {
    listener({ url });
    await Promise.resolve();
  });
}

describe('deep links in the router', () => {
  afterEach(() => {
    pendingLinks.clear();
    linkGates.set('signed-in', false);
  });

  it('lands a cold link to an unlisted screen on the first screen', async () => {
    const view = await renderRouterWithProviders(ROUTES, {
      initialUrl: '/settings/delete-account',
    });
    expect(view.getPathname()).toBe('/');
  });

  it('opens a listed cold link with only the query keys its screen reads', async () => {
    const view = await renderRouterWithProviders(ROUTES, {
      initialUrl: '/tasks/task-7?highlight=a%26b&utm_source=mail',
    });
    expect(view.getPathname()).toBe('/tasks/task-7');
    expect(view.getSearchParams()).toStrictEqual({ taskId: 'task-7', highlight: 'a&b' });
  });

  it('opens a warm link and ignores one from another scheme', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/' });
    await sendUrl('tasks://tasks/task-9');
    expect(view.getPathname()).toBe('/tasks/task-9');
    await sendUrl('evil://settings/delete-account');
    expect(view.getPathname()).toBe('/tasks/task-9');
  });

  it('opens a gated cold link from the first screen behind the gate, with Back to it', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/lists/l-1' });
    expect(view.getPathname()).toBe('/lists/l-1');
    expect(router.canGoBack()).toBe(true);
    await act(() => {
      router.back();
    });
    expect(view.getPathname()).toBe('/');
    expect(screen.getByText('Home')).toBeOnTheScreen();
  });

  it('opens a gated warm link at once while the gate is open', async () => {
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/' });
    await sendUrl('tasks://lists/l-1');
    expect(view.getPathname()).toBe('/lists/l-1');
  });
});
