// test/forms/i18n-form-wrapper.tsx
// The provider tree for form hook and screen tests (forms-and-input): the canonical test providers
// (createProvidersWrapper: services, query cache, language, direction), then the app's real
// I18nProvider with its catalogs and a throwing onError, so a translated label or error is the
// catalog's text and a missing key fails the test. test/test-app.tsx carries no catalogs, which is
// why the form tests add the provider here.
import { I18nProvider } from '@/i18n/i18n-provider';
import { createProvidersWrapper } from '@test/render-with-providers';

import type { TestAppContext, TestAppOptions } from '@test/test-app';
import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

export type FormTestWrapper = TestAppContext & {
  readonly wrapper: (props: { readonly children: ReactNode }) => ReactNode;
};

/** A fresh provider tree with the app's catalogs, for RNTL's { wrapper }. */
export function createFormTestWrapper(options: TestAppOptions = {}): FormTestWrapper {
  const { wrapper: Providers, ...context } = createProvidersWrapper(options);
  const language = options.language ?? 'en';
  function FormTestProviders({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <Providers>
        <I18nProvider language={language} digits="automatic" onError={failOnError}>
          {children}
        </I18nProvider>
      </Providers>
    );
  }
  return { ...context, wrapper: FormTestProviders };
}
