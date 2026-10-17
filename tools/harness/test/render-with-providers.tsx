// test/render-with-providers.tsx — every component and hook test renders through this helper.
// Each call builds the app's provider tree fresh from test/test-app.tsx (the app's own wiring), so
// nothing leaks from one test into the next, and hands back what the tree holds (stores, services,
// the query cache) so the test can dispatch, seed or read a fake's call log. Tests reach it as
// @test/render-with-providers; every function here returns a promise (RNTL 14): await it.
import { render, renderHook } from '@testing-library/react-native';

import { createTestApp } from './test-app';

import type { TestAppContext, TestAppOptions } from './test-app';
import type { RenderHookResult, RenderResult } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

export type ProvidersWrapper = TestAppContext & {
  /** The provider tree, for an RNTL call that takes { wrapper }. */
  readonly wrapper: (props: { readonly children: ReactNode }) => ReactNode;
};

/** A fresh provider tree for one test, and what it holds. */
export function createProvidersWrapper(options: TestAppOptions = {}): ProvidersWrapper {
  const { context, Providers } = createTestApp(options);
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <Providers>{children}</Providers>
  );
  return { ...context, wrapper };
}

/** Renders `ui` inside the app's providers; the result also carries what the tree holds. */
export async function renderWithProviders(
  ui: ReactElement,
  options: TestAppOptions = {},
): Promise<RenderResult & TestAppContext> {
  const { wrapper, ...context } = createProvidersWrapper(options);
  const view = await render(ui, { wrapper });
  return Object.assign(view, context);
}

/** Renders a hook inside the app's providers; the result also carries what the tree holds. */
export async function renderHookWithProviders<TResult>(
  hook: () => TResult,
  options: TestAppOptions = {},
): Promise<RenderHookResult<TResult, undefined> & TestAppContext> {
  const { wrapper, ...context } = createProvidersWrapper(options);
  const view = await renderHook(hook, { wrapper });
  return Object.assign(view, context);
}
