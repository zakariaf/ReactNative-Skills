// src/features/__FEATURE__/use-__FEATURE__-model.test.tsx
// The model reads its copy through useT(), which needs the app's I18nProvider (the source catalog,
// and an onError that throws, so a missing key fails the test). The canonical test tree carries no
// catalogs, so the provider sits inside the providers createProvidersWrapper builds.
import { renderHook } from '@testing-library/react-native';

import { I18nProvider } from '@/i18n/i18n-provider';
import { createProvidersWrapper } from '@test/render-with-providers';

import { use__FEATURE_PASCAL__Model } from './use-__FEATURE__-model';

import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

/** A fresh provider tree for one test: the canonical providers, then the app's I18nProvider. */
function i18nWrapper(): (props: { readonly children: ReactNode }) => ReactNode {
  const { wrapper: Providers } = createProvidersWrapper();
  return function I18nWrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <Providers>
        <I18nProvider language="en" digits="automatic" onError={failOnError}>
          {children}
        </I18nProvider>
      </Providers>
    );
  };
}

describe('use__FEATURE_PASCAL__Model', () => {
  it('translates the title and the body from the catalog', async () => {
    const { result } = await renderHook(() => use__FEATURE_PASCAL__Model(), {
      wrapper: i18nWrapper(),
    });

    expect(result.current).toStrictEqual({ title: '__TITLE__', body: '__BODY__' });
  });
});
