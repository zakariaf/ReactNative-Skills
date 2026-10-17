// src/hooks/use-open-pending-link.test.tsx
// The first screen behind a gate opens the link that waited for it, once, on top of itself.
import { act, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { pendingLinks } from '@/services/deep-links/pending-link-inbox';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { useOpenPendingLink } from './use-open-pending-link';

import type { Href } from 'expo-router';
import type { ReactNode } from 'react';

/** Stand-in href of a stand-in route (typed routes know only the app's real files). */
const LIST_HREF = '/lists/l-1' as Href;

function HomeStandIn(): ReactNode {
  useOpenPendingLink('signed-in');
  return <AppText>Home</AppText>;
}

function ListStandIn(): ReactNode {
  return <AppText>List</AppText>;
}

const ROUTES = { index: HomeStandIn, 'lists/[listId]': ListStandIn };

describe('useOpenPendingLink', () => {
  afterEach(() => {
    pendingLinks.clear();
  });

  it('opens the waiting link on top of the screen, once', async () => {
    pendingLinks.offer({ gate: 'signed-in', target: LIST_HREF });
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/' });
    expect(view.getPathname()).toBe('/lists/l-1');
    await act(() => {
      router.back();
    });
    expect(view.getPathname()).toBe('/');
    expect(screen.getByText('Home')).toBeOnTheScreen();
  });

  it('leaves a link that waits for another gate', async () => {
    pendingLinks.offer({ gate: 'onboarded', target: LIST_HREF });
    const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/' });
    expect(view.getPathname()).toBe('/');
    expect(pendingLinks.take('onboarded')).toBe(LIST_HREF);
  });
});
