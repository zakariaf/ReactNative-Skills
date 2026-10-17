// src/features/debug/debug-routes.test.tsx
// The debug link end to end in Expo Router's in-memory router: the real route files, the gate (this
// is not a production bundle, so TEST_ONLY is the entry) and the app's en catalog in a stand-in root
// layout. A link applies its switches and replaces itself with the requested screen; a bad link
// stays on the refusal and applies nothing.
import { screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';

import DebugLayout from '@/app/(debug)/_layout';
import DebugMenuRoute from '@/app/(debug)/debug/index';
import DebugSetupRoute from '@/app/(debug)/debug/setup';
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

import type { FakeErrorLog } from '@/services/error-log/fake-error-log';
import type { TestHooks } from '@/services/test-hooks/create-test-hooks';
import type { DebugSettingsTarget } from '@/services/test-hooks/debug-settings-target';

function failOnError(error: Error): never {
  throw error;
}

type LinkRun = { readonly hooks: TestHooks; readonly errorLog: FakeErrorLog };

/** Builds the hooks the way the startup does and mounts the routes under a stand-in root layout. */
async function openLink(
  url: string,
  settings: DebugSettingsTarget | null = null,
): Promise<LinkRun> {
  const errorLog = createFakeErrorLog();
  const hooks = createTestHooks({
    services: createTestServices({
      clock: createFakeClock({ nowMs: 0, today: '2030-01-31' }),
      errorLog,
    }),
    storage: createFakeDebugStorage(),
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
  function Home(): React.JSX.Element {
    return <AppText testID="tasks.list">home</AppText>;
  }
  await renderRouterWithProviders(
    {
      _layout: RootLayout,
      '(app)/index': Home,
      '(debug)/_layout': DebugLayout,
      '(debug)/debug/index': DebugMenuRoute,
      '(debug)/debug/setup': DebugSetupRoute,
    },
    { initialUrl: url, services: hooks.services },
  );
  return { hooks, errorLog };
}

describe('the debug link routes', () => {
  it('applies the switches, then replaces the link with the screen it names', async () => {
    const { hooks } = await openLink(
      `/${DEBUG_LINK_PATH}?date=2030-03-01&offline=1&motion=still&open=tasks`,
    );

    expect(await screen.findByTestId('tasks.list')).toBeOnTheScreen();
    expect(hooks.overrides.getState().overrides).toStrictEqual({
      ...DEFAULT_DEBUG_OVERRIDES,
      today: '2030-03-01',
      isOffline: true,
      motion: 'still',
    });
    expect(hooks.services.clock.today()).toBe('2030-03-01');
  });

  it('opens the debug menu when the link names no screen', async () => {
    const { hooks } = await openLink(`/${DEBUG_LINK_PATH}?probe=1`);

    expect(await screen.findByTestId('debug.menu')).toBeOnTheScreen();
    expect(hooks.overrides.getState().overrides.isCanvasProbeOn).toBe(true);
  });

  it('saves settings through the app target before it opens the screen', async () => {
    const apply = jest.fn<
      ReturnType<DebugSettingsTarget['apply']>,
      Parameters<DebugSettingsTarget['apply']>
    >(() => Promise.resolve('applied'));

    await openLink(`/${DEBUG_LINK_PATH}?lang=ar&theme=dark&open=tasks`, { apply });

    expect(await screen.findByTestId('tasks.list')).toBeOnTheScreen();
    expect(apply).toHaveBeenCalledWith({ language: 'ar', theme: 'dark' });
  });

  it('stays put when the settings change restarts the app', async () => {
    await openLink(`/${DEBUG_LINK_PATH}?lang=ar&open=tasks`, {
      apply: () => Promise.resolve('restarting'),
    });

    expect(await screen.findByTestId('debug.setup')).toBeOnTheScreen();
    expect(screen.queryByTestId('tasks.list')).not.toBeOnTheScreen();
  });

  it('refuses a bad link, says why, logs it and applies nothing', async () => {
    const { hooks, errorLog } = await openLink(`/${DEBUG_LINK_PATH}?offline=yes&date=2030-03-01`);

    expect(await screen.findByTestId('debug.setup-error')).toHaveTextContent(
      /debug-link-bad-value offline=yes/u,
    );
    expect(errorLog.entries().map((entry) => entry.message)).toStrictEqual([
      'debug link refused: debug-link-bad-value offline=yes',
    ]);
    expect(hooks.overrides.getState().overrides).toBe(DEFAULT_DEBUG_OVERRIDES);
  });

  it('refuses lang= when the startup passed no settings target', async () => {
    await openLink(`/${DEBUG_LINK_PATH}?lang=ar`);

    expect(await screen.findByTestId('debug.setup-error')).toHaveTextContent(
      /debug-link-settings-not-wired/u,
    );
  });
});
