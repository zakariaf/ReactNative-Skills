// test/test-app.tsx — the app's provider tree for component and hook tests, built from test inputs.
// renderWithProviders (test/render-with-providers.tsx) calls createTestApp once per render, so no
// store, cache or fake outlives a test. This file is the app's own: keep the same providers, in the
// same order, as the root layout (src/app/_layout.tsx), and add each one when the app gains it:
//   - services (wired from the start): createTestServices(options.services) inside ServicesProvider,
//     the composition root's test twin; ports a test does not pass throw on first use and name
//     themselves, so a component that reaches for an unexpected port fails loudly;
//   - language and direction (wired from the start): `language` picks the catalog, the locale tag
//     (the language's digits) and the text locale; `direction` is the layout direction
//     DirectionGate provides (rtl-and-direction), by default the language's own, as after the
//     restart. Jest lays nothing out: a right-to-left render proves the code reads the direction,
//     never that the screen mirrors;
//   - the app's catalogs: import them and fill CATALOGS (a missing message must keep throwing);
//   - I18nProvider (i18n-strings-and-catalogs) in place of the bare IntlProvider and LanguageContext
//     once the app has it, with the same throwing onError (useT() and <T> need it);
//   - stores: the real store factories over fakes the options seed first (never a module-level store);
//   - theme, safe-area metrics, navigation, anything else the root layout provides.
// Options other skills' tests rely on once their modules land (each a field of TestAppOptions):
//   - `settings` (settings-and-preferences): createSettingsStore over
//     createFakeSettingsStorage(options.settings) inside SettingsStoreProvider, the store in context;
//   - `reduceMotion` (accessibility-as-code): MotionConfig around the tree, with
//     preference={options.reduceMotion ?? 'off'}, so a screen test can prove the reduced end state.
// Return in `context` whatever a test must reach: stores to call actions on, fakes to read.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from 'react-intl';

import { localeTagFor } from '@/i18n/digits';
import { DirectionProvider } from '@/i18n/direction-context';
import { LanguageContext } from '@/i18n/language-context';
import { SOURCE_LANGUAGE, directionOf } from '@/i18n/languages';
import { createTestServices } from '@/services/create-test-services';
import { ServicesProvider } from '@/services/services-context';
import { TextLocaleProvider } from '@/theme/text-locale';

import type { Direction, Language } from '@/i18n/languages';
import type { Services } from '@/services/services-context';
import type { ComponentType, ReactNode } from 'react';
import type { IntlConfig } from 'react-intl';

type Catalog = Readonly<Record<string, string>>;

/** The app's catalogs by language. Empty until the app has catalogs: every message is then missing. */
const CATALOGS: Readonly<Partial<Record<Language, Catalog>>> = {
  en: {},
};

/** What a test may choose. Add a field when the app gains something a test must seed. */
export type TestAppOptions = {
  /** The UI language: catalog, locale tag and text locale. Default SOURCE_LANGUAGE ('en'). */
  readonly language?: Language;
  /** The layout direction DirectionGate would provide. Default: the language's own direction. */
  readonly direction?: Direction;
  /** The ports this test gives (fakes); every other port throws on first use and names itself. */
  readonly services?: Partial<Services>;
};

/** What a test gets back from renderWithProviders and createProvidersWrapper. */
export type TestAppContext = {
  /** This render's TanStack Query cache: seed it with setQueryData, read it after a mutation. */
  readonly queryClient: QueryClient;
  /** This render's ports: the fakes the test gave, and a throwing stand-in for every other port. */
  readonly services: Services;
};

export type TestApp = {
  readonly context: TestAppContext;
  readonly Providers: ComponentType<{ readonly children: ReactNode }>;
};

/** A missing message or a broken ICU string fails the test with react-intl's own error. */
const failOnIntlError: NonNullable<IntlConfig['onError']> = (error) => {
  throw error;
};

/** One fresh provider tree and the state it holds. */
export function createTestApp(options: TestAppOptions = {}): TestApp {
  const language = options.language ?? SOURCE_LANGUAGE;
  const textLocale = { language, direction: directionOf(language) };
  const layoutDirection = options.direction ?? textLocale.direction;
  const services = createTestServices(options.services);
  // No retries (a failing query fails at once) and no garbage-collection timer left running.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  function Providers({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <DirectionProvider direction={layoutDirection}>
        <ServicesProvider services={services}>
          <IntlProvider
            locale={localeTagFor(language, 'automatic')}
            messages={CATALOGS[language] ?? {}}
            defaultLocale={SOURCE_LANGUAGE}
            onError={failOnIntlError}
          >
            <LanguageContext value={language}>
              <TextLocaleProvider value={textLocale}>
                <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
              </TextLocaleProvider>
            </LanguageContext>
          </IntlProvider>
        </ServicesProvider>
      </DirectionProvider>
    );
  }
  return { context: { queryClient, services }, Providers };
}
