// src/i18n/direction-gate.test.tsx
// no-providers: DirectionGate is the root layout's first element and mounts above every provider.
import { render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';

import { createFakeDirectionGuard } from '@/services/direction-guard/fake-direction-guard';

import { DirectionGate } from './direction-gate';

import type { DirectionGiveUp } from './direction-gate';
import type { Language } from './languages';
import type { DirectionGuardFailure } from '@/services/direction-guard/direction-guard-port';
import type { FakeDirectionGuard } from '@/services/direction-guard/fake-direction-guard';

/** expo's reloadAppAsync calls the global expo object; spy there instead of mocking the package. */
function spyOnReload(): jest.SpyInstance {
  return jest.spyOn(globalThis.expo, 'reloadAppAsync').mockResolvedValue(undefined);
}

type GateReports = {
  readonly giveUps: DirectionGiveUp[];
  readonly guardFailures: DirectionGuardFailure[];
};

async function showGate(language: Language, guard: FakeDirectionGuard): Promise<GateReports> {
  const reports: GateReports = { giveUps: [], guardFailures: [] };
  await render(
    <DirectionGate
      language={language}
      guard={guard}
      onGiveUp={(giveUp) => {
        reports.giveUps.push(giveUp);
      }}
      onGuardFailure={(failure) => {
        reports.guardFailures.push(failure);
      }}
    >
      <View testID="app.root" />
    </DirectionGate>,
  );
  return reports;
}

describe('DirectionGate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the app and clears the record when the layout already matches (Jest lays out LTR)', async () => {
    const reload = spyOnReload();
    const guard = createFakeDirectionGuard({ pending: 'ltr' });

    const { giveUps, guardFailures } = await showGate('en', guard);

    expect(screen.getByTestId('app.root')).toBeOnTheScreen();
    expect(guard.writes).toStrictEqual([null]);
    expect(giveUps).toStrictEqual([]);
    expect(guardFailures).toStrictEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('shows only the restart screen and reloads once into a right-to-left language', async () => {
    const reload = spyOnReload();
    const guard = createFakeDirectionGuard();

    await showGate('ar', guard);

    expect(screen.getByTestId('direction.restart-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('app.root')).not.toBeOnTheScreen();
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(guard.writes).toStrictEqual(['rtl']);
  });

  it('passes beforeReload through to the restart, so it runs before the reload', async () => {
    const steps: string[] = [];
    jest.spyOn(globalThis.expo, 'reloadAppAsync').mockImplementation(() => {
      steps.push('reload');
      return Promise.resolve();
    });

    await render(
      <DirectionGate
        language="ar"
        guard={createFakeDirectionGuard()}
        onGiveUp={jest.fn()}
        onGuardFailure={jest.fn()}
        beforeReload={() => {
          steps.push('before-reload');
          return Promise.resolve();
        }}
      >
        <View testID="app.root" />
      </DirectionGate>,
    );

    await waitFor(() => {
      expect(steps).toStrictEqual(['before-reload', 'reload']);
    });
  });

  it('gives up instead of looping when the last reload was for the same direction', async () => {
    const reload = spyOnReload();
    const guard = createFakeDirectionGuard({ pending: 'rtl' });

    const { giveUps, guardFailures } = await showGate('ar', guard);

    expect(screen.getByTestId('app.root')).toBeOnTheScreen();
    expect(giveUps).toStrictEqual([{ layout: 'ltr', wanted: 'rtl', reason: 'flip-did-not-take' }]);
    expect(guardFailures).toStrictEqual([]);
    expect(guard.writes).toStrictEqual([null]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('renders the app without reloading when the record cannot be written', async () => {
    const reload = spyOnReload();
    const guard = createFakeDirectionGuard({ isWriteFailing: true });

    const { giveUps, guardFailures } = await showGate('ar', guard);

    expect(await screen.findByTestId('app.root')).toBeOnTheScreen();
    expect(giveUps).toStrictEqual([{ layout: 'ltr', wanted: 'rtl', reason: 'restart-failed' }]);
    expect(guardFailures).toStrictEqual([{ kind: 'direction-guard-not-saved' }]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('gives up instead of restarting when the guard cannot be read', async () => {
    const reload = spyOnReload();
    const guard = createFakeDirectionGuard({ isReadFailing: true });

    const { giveUps, guardFailures } = await showGate('ar', guard);

    expect(screen.getByTestId('app.root')).toBeOnTheScreen();
    expect(screen.queryByTestId('direction.restart-screen')).not.toBeOnTheScreen();
    expect(giveUps).toStrictEqual([{ layout: 'ltr', wanted: 'rtl', reason: 'guard-unreadable' }]);
    expect(guardFailures).toStrictEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reports a record it cannot clear, and still renders the app', async () => {
    const guard = createFakeDirectionGuard({ pending: 'ltr', isWriteFailing: true });

    const { giveUps, guardFailures } = await showGate('en', guard);

    expect(screen.getByTestId('app.root')).toBeOnTheScreen();
    expect(guardFailures).toStrictEqual([{ kind: 'direction-guard-not-saved' }]);
    expect(giveUps).toStrictEqual([]);
  });
});
