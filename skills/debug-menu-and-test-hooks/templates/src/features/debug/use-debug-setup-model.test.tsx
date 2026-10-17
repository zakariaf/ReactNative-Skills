// src/features/debug/use-debug-setup-model.test.tsx
// The link screen's model on its own, in Expo Router's in-memory router with a stand-in link route
// that shows the model: parse once, apply in order, replace with the target, and refuse (logged,
// nothing applied) a link or a settings change that fails.
import { screen } from '@testing-library/react-native';
import { Slot, useLocalSearchParams } from 'expo-router';

import { I18nProvider } from '@/i18n/i18n-provider';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createTestServices } from '@/services/create-test-services';
import { createFakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createTestHooks } from '@/services/test-hooks/create-test-hooks';
import { DEFAULT_DEBUG_OVERRIDES } from '@/stores/debug-overrides/debug-overrides';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { DEBUG_LINK_PATH } from './debug-links';
import { TestHooksProvider } from './test-hooks-context';
import { useDebugSetupModel } from './use-debug-setup-model';

import type { FakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import type { FakeErrorLog } from '@/services/error-log/fake-error-log';
import type { TestHooks } from '@/services/test-hooks/create-test-hooks';
import type { DebugSettingsTarget } from '@/services/test-hooks/debug-settings-target';
import type { RouterView } from '@test/render-router-with-providers';

function failOnError(error: Error): never {
  throw error;
}

type LinkRun = {
  readonly hooks: TestHooks;
  readonly errorLog: FakeErrorLog;
  readonly view: RouterView;
};

/** Opens `query` on the link path with a stand-in route that renders the model's state. */
async function openLink(
  query: string,
  settings: DebugSettingsTarget | null = null,
  storage: FakeDebugStorage = createFakeDebugStorage(),
): Promise<LinkRun> {
  const errorLog = createFakeErrorLog();
  const hooks = createTestHooks({
    services: createTestServices({
      clock: createFakeClock({ nowMs: 0, today: '2030-01-31' }),
      errorLog,
    }),
    storage,
    settings,
  });
  function RootLayout(): React.JSX.Element {
    return (
      <TestHooksProvider hooks={hooks}>
        <I18nProvider language="en" digits="automatic" onError={failOnError}>
          <Slot />
        </I18nProvider>
      </TestHooksProvider>
    );
  }
  function LinkRoute(): React.JSX.Element {
    const model = useDebugSetupModel(useLocalSearchParams());
    return (
      <AppText testID={model.isFailed ? 'link.failed' : 'link.applying'}>{model.label}</AppText>
    );
  }
  function Home(): React.JSX.Element {
    return <AppText testID="tasks.list">home</AppText>;
  }
  function Menu(): React.JSX.Element {
    return <AppText testID="debug.menu">menu</AppText>;
  }
  const view = await renderRouterWithProviders(
    { _layout: RootLayout, index: Home, 'debug/index': Menu, [DEBUG_LINK_PATH]: LinkRoute },
    { initialUrl: `/${DEBUG_LINK_PATH}?${query}`, services: hooks.services },
  );
  return { hooks, errorLog, view };
}

describe('useDebugSetupModel', () => {
  it('applies the switches first, then replaces the link with the screen open= names', async () => {
    const { hooks, view } = await openLink('offline=1&date=2030-03-01&open=tasks');

    expect(await screen.findByTestId('tasks.list')).toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
    expect(hooks.overrides.getState().overrides).toStrictEqual({
      ...DEFAULT_DEBUG_OVERRIDES,
      today: '2030-03-01',
      isOffline: true,
    });
  });

  it('ends on the debug menu when the link names no screen', async () => {
    await openLink('motion=still');

    expect(await screen.findByTestId('debug.menu')).toBeOnTheScreen();
  });

  it('refuses a repeated parameter, logs it and applies nothing', async () => {
    const { hooks, errorLog } = await openLink('offline=1&offline=0');

    expect(await screen.findByTestId('link.failed')).toHaveTextContent(
      /debug-link-repeated-param offline/u,
    );
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'debug link refused: debug-link-repeated-param offline',
    ]);
    expect(hooks.overrides.getState().overrides).toBe(DEFAULT_DEBUG_OVERRIDES);
  });

  it('logs a settings target that throws and says the link failed', async () => {
    const { errorLog } = await openLink('theme=dark&open=tasks', {
      apply: () => Promise.reject(new Error('settings not saved')),
    });

    expect(await screen.findByTestId('link.failed')).toHaveTextContent(
      /debug-link-settings-failed/u,
    );
    // The error log lists the newest entry first: the cause, then the refusal it led to.
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'debug link refused: debug-link-settings-failed',
      'settings not saved',
    ]);
    expect(screen.queryByTestId('tasks.list')).not.toBeOnTheScreen();
  });

  it('refuses the link and stays when a switch could not be saved', async () => {
    const storage = createFakeDebugStorage();
    storage.failOn('write');
    const { hooks } = await openLink('offline=1&open=tasks', null, storage);

    expect(await screen.findByTestId('link.failed')).toHaveTextContent(
      /debug-link-overrides-not-saved/u,
    );
    expect(screen.queryByTestId('tasks.list')).not.toBeOnTheScreen();
    expect(hooks.overrides.getState().overrides).toBe(DEFAULT_DEBUG_OVERRIDES);
  });

  it('refuses a settings link without a settings target before applying any switch', async () => {
    const { hooks } = await openLink('date=2030-03-01&theme=dark&open=tasks');

    expect(await screen.findByTestId('link.failed')).toHaveTextContent(
      /debug-link-settings-not-wired/u,
    );
    expect(hooks.overrides.getState().overrides).toBe(DEFAULT_DEBUG_OVERRIDES);
  });
});
