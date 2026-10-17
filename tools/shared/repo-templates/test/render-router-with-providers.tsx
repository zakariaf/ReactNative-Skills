// test/render-router-with-providers.tsx — route tests: Expo Router's in-memory router (renderRouter
// from expo-router/testing-library) inside the same provider tree as renderWithProviders. Pass the
// routes as { 'route/path': Component } (route files' default exports, or small stand-ins) and read
// where the router is from the returned getters. Await it, like every RNTL 14 render.
// Why a helper: with expo-router 57.0.24 and RNTL 14.0.1 (verified 2026-10-03), renderRouter returns
// RNTL's render promise with the route getters attached to the promise itself, so `await
// renderRouter(...)` waits for the render but hands back a result without them; its Jest matchers
// (toHavePathname, ...) and testRouter throw "screen.getPathname is not a function"; and it switches
// on fake timers that stay on for the rest of the test file. Expo's SDK 57 testing guide still shows
// `expect(screen).toHavePathname(...)`, which throws with these versions. This helper keeps the
// promise, waits for the first commit, reads the route through its getters, and restores real timers.
import { renderRouter } from 'expo-router/testing-library';

import { createProvidersWrapper } from './render-with-providers';

import type { TestAppContext, TestAppOptions } from './test-app';
import type { MockContextConfig } from 'expo-router/testing-library';

export type RouterTestOptions = TestAppOptions & {
  /** The URL the router opens first, as a deep link would. Default '/'. */
  readonly initialUrl?: string;
};

export type RouterView = TestAppContext & {
  /** The current pathname, '/tasks/7'. */
  readonly getPathname: () => string;
  /** The current route segments, ['tasks', '[id]']. */
  readonly getSegments: () => readonly string[];
  /** The current route params, { id: '7' }. */
  readonly getSearchParams: () => Readonly<Record<string, string | readonly string[]>>;
};

/** Mounts `routes` in Expo Router inside the app's providers and waits for the first commit. */
export async function renderRouterWithProviders(
  routes: MockContextConfig,
  options: RouterTestOptions = {},
): Promise<RouterView> {
  const { initialUrl = '/', ...appOptions } = options;
  const { wrapper, ...context } = createProvidersWrapper(appOptions);
  const view = renderRouter(routes, { initialUrl, wrapper });
  // The returned object is RNTL's render promise with the route getters attached; Promise.resolve
  // adopts it, so this line waits for React to commit the first route.
  await Promise.resolve(view);
  jest.useRealTimers();
  return {
    ...context,
    getPathname: () => view.getPathname(),
    getSegments: () => view.getSegments(),
    getSearchParams: () => view.getSearchParams(),
  };
}
