// src/features/crash-recovery/create-route-error-boundary.test.tsx
// no-providers: the boundary and its stand-in fallback read only their props, and under the root
// layout the boundary renders outside every provider, so the unit cases render it with none.
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { Button, View } from 'react-native';

import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { createRouteErrorBoundary } from './create-route-error-boundary';

import type { CrashFallbackProps } from './create-route-error-boundary';

function TestFallback({ onRestart }: CrashFallbackProps): React.JSX.Element {
  return (
    <View testID="crash.screen">
      <Button testID="crash.restart-button" title="Restart" onPress={onRestart} />
    </View>
  );
}

describe('createRouteErrorBoundary', () => {
  beforeEach(() => {
    // React reports caught render errors through console.error; keep the output readable.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('records the caught error once and shows the fallback', async () => {
    const record = jest.fn();
    const RouteBoundary = createRouteErrorBoundary({ record, Fallback: TestFallback });
    const error = new Error('render failed');

    await render(<RouteBoundary error={error} retry={() => Promise.resolve()} />);

    expect(screen.getByRole('button', { name: 'Restart' })).toBeOnTheScreen();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(error);
  });

  it('retries only when the user presses the way out', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup();
    const retry = jest.fn(() => Promise.resolve());
    const RouteBoundary = createRouteErrorBoundary({ record: jest.fn(), Fallback: TestFallback });
    await render(<RouteBoundary error={new Error('render failed')} retry={retry} />);

    await act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(retry).not.toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: 'Restart' }));

    expect(retry).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('records a failing restart instead of leaving a floating rejection', async () => {
    const user = userEvent.setup();
    const record = jest.fn();
    const restartFailure = new Error('reload failed');
    const RouteBoundary = createRouteErrorBoundary({
      record,
      Fallback: TestFallback,
      restart: () => Promise.reject(restartFailure),
    });
    await render(
      <RouteBoundary error={new Error('render failed')} retry={() => Promise.resolve()} />,
    );

    await user.press(screen.getByRole('button', { name: 'Restart' }));

    expect(record).toHaveBeenLastCalledWith(restartFailure);
  });

  // Through Expo Router: its real boundary picks up the ErrorBoundary export. The helper's test
  // providers sit above the router; the stand-in fallback reads none of them, and crash-fallback's
  // own test proves the app's fallback renders with no provider at all.
  it('catches a route that throws while rendering when a layout exports it as ErrorBoundary', async () => {
    const record = jest.fn();
    const RootBoundary = createRouteErrorBoundary({ record, Fallback: TestFallback });
    const BrokenScreen = (): React.JSX.Element => {
      throw new Error('task list failed to render');
    };

    await renderRouterWithProviders({
      _layout: { default: () => <Stack />, ErrorBoundary: RootBoundary },
      index: BrokenScreen,
    });

    expect(await screen.findByRole('button', { name: 'Restart' })).toBeOnTheScreen();
    expect(record).toHaveBeenCalledWith(new Error('task list failed to render'));
  });

  it('catches an error thrown by the root layout itself, the startup case', async () => {
    const record = jest.fn();
    const RootBoundary = createRouteErrorBoundary({ record, Fallback: TestFallback });
    const BrokenLayout = (): React.JSX.Element => {
      throw new Error('providers failed to start');
    };

    await renderRouterWithProviders({
      _layout: { default: BrokenLayout, ErrorBoundary: RootBoundary },
      index: () => <AppText>Your tasks</AppText>,
    });

    expect(await screen.findByRole('button', { name: 'Restart' })).toBeOnTheScreen();
    expect(screen.queryByText('Your tasks')).toBeNull();
    expect(record).toHaveBeenCalledWith(new Error('providers failed to start'));
  });
});
