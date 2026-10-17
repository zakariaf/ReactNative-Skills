// src/i18n/direction-restart.test.tsx
// no-providers: DirectionRestart is a root of its own; it mounts the text locale it needs itself.
import { render, screen, waitFor } from '@testing-library/react-native';

import { createFakeDirectionGuard } from '@/services/direction-guard/fake-direction-guard';
import { useTextLocale } from '@/theme/use-text-locale';
import { AppText } from '@/ui/app-text';

import { DirectionRestart } from './direction-restart';

import type { ReactNode } from 'react';

/** expo's reloadAppAsync calls the global expo object; spy there instead of mocking the package. */
function spyOnReload(): jest.SpyInstance {
  return jest.spyOn(globalThis.expo, 'reloadAppAsync').mockResolvedValue(undefined);
}

/** Shows the text locale the restart screen draws its text with. */
function LocaleProbe(): ReactNode {
  const locale = useTextLocale();
  return <AppText>{`${locale.language} ${locale.direction}`}</AppText>;
}

describe('DirectionRestart', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records the direction and reloads once, after it is mounted', async () => {
    const reload = spyOnReload();
    const guard = createFakeDirectionGuard();

    await render(<DirectionRestart language="ar" guard={guard} onFailed={jest.fn()} />);

    expect(screen.getByTestId('direction.restart-screen')).toBeOnTheScreen();
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(guard.writes).toStrictEqual(['rtl']);
  });

  it('runs beforeReload after recording the direction and before the reload', async () => {
    const steps: string[] = [];
    jest.spyOn(globalThis.expo, 'reloadAppAsync').mockImplementation(() => {
      steps.push('reload');
      return Promise.resolve();
    });
    const guard = createFakeDirectionGuard();

    await render(
      <DirectionRestart
        language="ar"
        guard={guard}
        onFailed={jest.fn()}
        beforeReload={() => {
          steps.push(`before-reload after ${guard.writes.join(',')}`);
          return Promise.resolve();
        }}
      />,
    );

    await waitFor(() => {
      expect(steps).toStrictEqual(['before-reload after rtl', 'reload']);
    });
  });

  it('draws its screen in the text locale of the language it restarts into', async () => {
    spyOnReload();

    await render(
      <DirectionRestart
        language="ar"
        guard={createFakeDirectionGuard()}
        onFailed={jest.fn()}
        screen={<LocaleProbe />}
      />,
    );

    expect(screen.getByText('ar rtl')).toBeOnTheScreen();
  });

  it('reports a failure instead of reloading when the record cannot be written', async () => {
    const reload = spyOnReload();
    const onFailed = jest.fn();

    await render(
      <DirectionRestart
        language="ar"
        guard={createFakeDirectionGuard({ isWriteFailing: true })}
        onFailed={onFailed}
      />,
    );

    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledTimes(1);
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
