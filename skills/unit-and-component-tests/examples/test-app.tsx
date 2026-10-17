// test/test-app.tsx — EXAMPLE (a shape to imitate, not a template): the wiring of a Tasks app with
// the whole canonical stack. Each import names the module another skill creates; keep the
// providers in the order src/app/_layout.tsx uses them (services outermost: the stores and the data
// layer are built from them). The layout direction DirectionGate provides (rtl-and-direction) wraps
// everything, as in the root layout. Eight providers exceed react/jsx-max-depth (5): an app this size
// moves the outer ones into a second file (test/test-root.tsx) the way the root layout does.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createFakeTaskRepository } from '@/data/tasks/fake-task-repository'; // persistence-and-migrations
import { DirectionProvider } from '@/i18n/direction-context'; // rtl-and-direction
import { I18nProvider } from '@/i18n/i18n-provider'; // i18n-strings-and-catalogs
import { directionOf } from '@/i18n/languages';
import { createFakeClock } from '@/services/clock/fake-clock'; // architecture-and-boundaries
import { createTestServices } from '@/services/create-test-services';
import { ServicesProvider } from '@/services/services-context';
import { createStores } from '@/stores/create-stores'; // state-management-zustand
import { StoresProvider } from '@/stores/stores-context';
import { TextLocaleProvider } from '@/theme/text-locale'; // design-system-structure
import { ThemeProvider } from '@/theme/theme-provider';

import type { FakeTaskRepository } from '@/data/tasks/fake-task-repository';
import type { NewList, NewTask } from '@/data/tasks/task-schema';
import type { Direction, Language } from '@/i18n/languages';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { Services } from '@/services/services-context';
import type { Stores } from '@/stores/stores-context';
import type { ThemePreference } from '@/theme/theme-types';
import type { ComponentType, ReactNode } from 'react';

export type TestAppOptions = {
  /** Default 'en'; 'ar' renders the app's catalog, digits and text direction for Arabic. */
  readonly language?: Language;
  /** The layout direction DirectionGate provides. Default: the language's own (after the restart). */
  readonly direction?: Direction;
  /** The fakes this test uses; every other port throws on first use and names itself. */
  readonly services?: Partial<Services>;
  /** Rows on "disk" before the first render, in order (ids count up from 1 across lists and tasks). */
  readonly seed?: TestSeed;
  readonly theme?: ThemePreference;
};

/** Written through the fake repository's own methods, so a seed passes the app's validation. */
export type TestSeed = {
  readonly lists?: readonly NewList[];
  readonly tasks?: readonly NewTask[];
};

export type TestAppContext = {
  readonly services: Services;
  /** Call their actions to change state from outside React (inside act()). */
  readonly stores: Stores;
  /** The fake data layer under the stores: plan a failed write, read what was saved. */
  readonly tasks: FakeTaskRepository;
  readonly queryClient: QueryClient;
};

export type TestApp = {
  readonly context: TestAppContext;
  readonly Providers: ComponentType<{ readonly children: ReactNode }>;
};

/** 2026-10-03 12:00 UTC, twelve hours before midnight: the clock unless the test passes one. */
const TEST_CLOCK = createFakeClock({ nowMs: 1_791_028_800_000, today: '2026-10-03' });

/** Anything the app records as an error fails the test with that error. */
const THROWING_ERROR_LOG: ErrorLogPort = {
  record: (_source, error) => {
    throw error;
  },
  entries: () => [],
};

/** A seed row the repository refuses is a broken test, not an empty screen. */
function mustSave(saved: { readonly ok: boolean }): void {
  if (!saved.ok) {
    throw new Error(`the test seed holds a row the repository refuses: ${JSON.stringify(saved)}`);
  }
}

/** A missing message or a broken ICU string fails the test (I18nProvider's onError). */
const failOnIntlError = (error: Error): void => {
  throw error;
};

/** Safe-area insets of a notched phone, so useSafeAreaInsets() has values in Jest. */
const TEST_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const language = options.language ?? 'en';
  const textLocale = { language, direction: directionOf(language) };
  const layoutDirection = options.direction ?? textLocale.direction;
  const services = createTestServices({
    clock: TEST_CLOCK,
    errorLog: THROWING_ERROR_LOG,
    ...options.services,
  });
  // The stores read the data layer once, when created (state-management-zustand's createStores
  // over AppData's repositories), so the seed is written to the fake repository first.
  const tasks = createFakeTaskRepository(services.clock);
  for (const list of options.seed?.lists ?? []) mustSave(tasks.addList(list));
  for (const task of options.seed?.tasks ?? []) mustSave(tasks.addTask(task));
  const stores = createStores({ tasks });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  function Providers({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <DirectionProvider direction={layoutDirection}>
        <SafeAreaProvider initialMetrics={TEST_METRICS}>
          <ServicesProvider services={services}>
            <StoresProvider stores={stores}>
              <I18nProvider language={language} digits="automatic" onError={failOnIntlError}>
                <ThemeProvider preference={options.theme ?? 'light'}>
                  <TextLocaleProvider value={textLocale}>
                    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                  </TextLocaleProvider>
                </ThemeProvider>
              </I18nProvider>
            </StoresProvider>
          </ServicesProvider>
        </SafeAreaProvider>
      </DirectionProvider>
    );
  }
  return { context: { services, stores, tasks, queryClient }, Providers };
}
