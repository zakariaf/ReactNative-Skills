// src/features/__DETAIL__/use-__DETAIL__-model.test.tsx
// The model inside a real router (Expo Router's in-memory router; the router is never mocked): it
// reads the id from the URL, turns a bad link into the invalid-link state, and its way out returns to
// the first screen instead of stacking a copy of it.
import { act, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';

import { I18nProvider } from '@/i18n/i18n-provider';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { use__DETAIL_PASCAL__Model } from './use-__DETAIL__-model';

import type { __DETAIL_PASCAL__Model } from './use-__DETAIL__-model';
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

/** Captures the model the hook returns on every render; the test reads the latest one. */
const seen: __DETAIL_PASCAL__Model[] = [];

function ModelProbe(): ReactNode {
  const model = use__DETAIL_PASCAL__Model();
  seen.push(model);
  return <AppText>{model.title}</AppText>;
}

function latest(): __DETAIL_PASCAL__Model {
  const model = seen.at(-1);
  if (model === undefined) throw new Error('the probe never rendered');
  return model;
}

const ROUTES = {
  _layout: TestLayout,
  index: HomeStandIn,
  '__DETAIL_ROUTE_ID__': ModelProbe,
};

describe('use__DETAIL_PASCAL__Model', () => {
  beforeEach(() => {
    seen.length = 0;
  });

  it('reads the id from the URL in the ready state and translates its copy', async () => {
    await renderRouterWithProviders(ROUTES, { initialUrl: '__DETAIL_HREF_BASE__/item-7' });

    expect(latest().state).toStrictEqual({ kind: 'ready', __PARAM__: 'item-7' });
    expect(latest().title).toBe('__DETAIL_TITLE__');
    expect(latest().body).toBe('__DETAIL_BODY__');
    expect(latest().isReducedMotion).toBe(false);
  });

  it('shows the invalid-link state for an id that does not parse', async () => {
    await renderRouterWithProviders(ROUTES, { initialUrl: '__DETAIL_HREF_BASE__/Not%20An%20Id' });

    expect(latest().state).toStrictEqual({ kind: 'invalid-link' });
    expect(latest().invalidLinkText).toBe(
      'This link doesn’t open anything in the app. It may be old or mistyped.',
    );
    expect(latest().goHomeLabel).toBe('Go to the first screen');
  });

  it('replaces a dead link with the first screen, leaving nothing to go back to', async () => {
    const view = await renderRouterWithProviders(ROUTES, {
      initialUrl: '__DETAIL_HREF_BASE__/Not%20An%20Id',
    });

    await act(() => {
      latest().onGoHome();
    });

    expect(await screen.findByText('Home')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
  });
});
