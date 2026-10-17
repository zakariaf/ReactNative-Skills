// src/features/debug/debug-menu.test.tsx
// The debug menu through its root component (model + view) inside the app's providers and the real
// en catalog: every switch writes the one store a debug link writes.
import { fireEvent, screen } from '@testing-library/react-native';

import { I18nProvider } from '@/i18n/i18n-provider';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createTestServices } from '@/services/create-test-services';
import { createFakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createTestHooks } from '@/services/test-hooks/create-test-hooks';
import { DEFAULT_DEBUG_OVERRIDES } from '@/stores/debug-overrides/debug-overrides';
import { renderWithProviders } from '@test/render-with-providers';

import { DebugMenuRoot } from './debug-menu-root';
import { TestHooksProvider } from './test-hooks-context';

import type { TestHooks } from '@/services/test-hooks/create-test-hooks';

/** t() wraps every *Text value in FSI ... PDI (bidi isolation). */
function isolated(text: string): string {
  return `\u2068${text}\u2069`;
}

function failOnError(error: Error): never {
  throw error;
}

/** The menu inside the providers, over hooks built from fakes (the way the startup builds them). */
async function openMenu(): Promise<TestHooks> {
  const errorLog = createFakeErrorLog();
  errorLog.record('service', new Error('earlier failure'));
  const hooks = createTestHooks({
    services: createTestServices({
      clock: createFakeClock({ nowMs: 0, today: '2030-01-31' }),
      errorLog,
    }),
    storage: createFakeDebugStorage(),
    settings: null,
  });
  await renderWithProviders(
    <TestHooksProvider hooks={hooks}>
      <I18nProvider language="en" digits="automatic" onError={failOnError}>
        <DebugMenuRoot />
      </I18nProvider>
    </TestHooksProvider>,
    { services: hooks.services },
  );
  return hooks;
}

describe('DebugMenuRoot', () => {
  it('shows the build, the real day and the error count', async () => {
    await openMenu();

    expect(screen.getByTestId('debug.menu.build')).toHaveTextContent(
      `Build: ${isolated('development')}`,
    );
    expect(screen.getByTestId('debug.menu.day')).toHaveTextContent(
      `Day: ${isolated('Real calendar')}`,
    );
    expect(screen.getByTestId('debug.menu.errors')).toHaveTextContent('Errors logged: 1');
  });

  it('toggles each switch in the shared store', async () => {
    const hooks = await openMenu();

    await fireEvent.press(screen.getByTestId('debug.menu.offline'));
    await fireEvent.press(screen.getByTestId('debug.menu.motion'));
    await fireEvent.press(screen.getByTestId('debug.menu.probe'));

    expect(hooks.overrides.getState().overrides).toStrictEqual({
      ...DEFAULT_DEBUG_OVERRIDES,
      isOffline: true,
      motion: 'still',
      isCanvasProbeOn: true,
    });
    expect(screen.getByTestId('debug.menu.offline')).toBeChecked();
  });

  it('simulates the next day from the real one, then from itself, then goes back', async () => {
    const hooks = await openMenu();

    await fireEvent.press(screen.getByTestId('debug.menu.next-day'));
    await fireEvent.press(screen.getByTestId('debug.menu.next-day'));

    expect(screen.getByTestId('debug.menu.day')).toHaveTextContent(
      `Day: ${isolated('2030-02-02')}`,
    );

    await fireEvent.press(screen.getByTestId('debug.menu.real-day'));

    expect(hooks.overrides.getState().overrides.today).toBeNull();
    expect(hooks.services.clock.today()).toBe('2030-01-31');
  });
});
