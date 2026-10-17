// src/features/debug/use-debug-menu-model.test.tsx
// The menu's model on its own, inside the app's providers and the real en catalog: its texts, its
// switches and day actions write the one store a debug link writes, and it follows what a link set.
import { act, renderHook } from '@testing-library/react-native';

import { I18nProvider } from '@/i18n/i18n-provider';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createTestServices } from '@/services/create-test-services';
import { createFakeDebugStorage } from '@/services/debug-storage/fake-debug-storage';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createTestHooks } from '@/services/test-hooks/create-test-hooks';
import { createProvidersWrapper } from '@test/render-with-providers';

import { TestHooksProvider } from './test-hooks-context';
import { useDebugMenuModel } from './use-debug-menu-model';

import type { DebugMenuModel, DebugSwitch } from './use-debug-menu-model';
import type { TestHooks } from '@/services/test-hooks/create-test-hooks';
import type { ReactNode } from 'react';

/** t() wraps every *Text value in FSI ... PDI (bidi isolation). */
function isolated(text: string): string {
  return `⁨${text}⁩`;
}

function failOnError(error: Error): never {
  throw error;
}

type ModelRun = { readonly model: () => DebugMenuModel; readonly hooks: TestHooks };

/** The model over hooks built from fakes, the way the startup builds them. */
async function renderModel(): Promise<ModelRun> {
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
  const { wrapper: AppProviders } = createProvidersWrapper({ services: hooks.services });
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <AppProviders>
        <TestHooksProvider hooks={hooks}>
          <I18nProvider language="en" digits="automatic" onError={failOnError}>
            {children}
          </I18nProvider>
        </TestHooksProvider>
      </AppProviders>
    );
  }
  const view = await renderHook(useDebugMenuModel, { wrapper: Wrapper });
  return { model: () => view.result.current, hooks };
}

function switchOf(model: DebugMenuModel, id: DebugSwitch['id']): DebugSwitch {
  const found = model.switches.find((row) => row.id === id);
  if (found === undefined) throw new Error(`no ${id} switch`);
  return found;
}

describe('useDebugMenuModel', () => {
  it('labels the build, the real calendar and the error count', async () => {
    const { model } = await renderModel();

    expect(model().buildText).toBe(`Build: ${isolated('development')}`);
    expect(model().dayText).toBe(`Day: ${isolated('Real calendar')}`);
    expect(model().errorsText).toBe('Errors logged: 1');
    expect(model().switches.map((row) => row.id)).toStrictEqual(['offline', 'motion', 'probe']);
  });

  it('turns a switch on and off again through the shared store', async () => {
    const { model, hooks } = await renderModel();

    await act(() => {
      switchOf(model(), 'offline').onToggle();
    });

    expect(switchOf(model(), 'offline').isOn).toBe(true);
    expect(hooks.overrides.getState().overrides.isOffline).toBe(true);

    await act(() => {
      switchOf(model(), 'offline').onToggle();
    });

    expect(hooks.overrides.getState().overrides.isOffline).toBe(false);
  });

  it("moves the day on from the clock's day, then returns to the real one", async () => {
    const { model, hooks } = await renderModel();

    await act(() => {
      model().actions[0]?.onPress();
    });

    expect(model().dayText).toBe(`Day: ${isolated('2030-02-01')}`);
    expect(hooks.services.clock.today()).toBe('2030-02-01');

    await act(() => {
      model().actions[1]?.onPress();
    });

    expect(hooks.overrides.getState().overrides.today).toBeNull();
  });

  it('shows what a debug link set', async () => {
    const { model, hooks } = await renderModel();

    await act(() => {
      hooks.overrides.getState().dispatch({
        type: 'apply-overrides',
        patch: { motion: 'still', isCanvasProbeOn: true },
      });
    });

    expect(switchOf(model(), 'motion').isOn).toBe(true);
    expect(switchOf(model(), 'probe').isOn).toBe(true);
  });
});
