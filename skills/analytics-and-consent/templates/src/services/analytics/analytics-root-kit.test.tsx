// src/services/analytics/analytics-root-kit.test.tsx
import { screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { View } from 'react-native';

import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { useAnalytics } from './analytics-context';
import { analyticsFlusher, createAnalyticsKit } from './analytics-root-kit';
import { createFakeAnalytics } from './fake-analytics';

import type { RootKit } from '@/services/root-kits/root-kit';

/** The root layout's part that matters here: the kit's provider around its effects and the navigator. */
function layoutWith(kit: RootKit): () => React.JSX.Element {
  return function KitLayout(): React.JSX.Element {
    const tree = (
      <>
        <Slot />
        {kit.effects}
      </>
    );
    return <>{kit.provide ? kit.provide(tree) : tree}</>;
  };
}

describe('createAnalyticsKit', () => {
  it('sends one screen_view per route pattern, never the id in the path', async () => {
    const analytics = createFakeAnalytics();
    const kit = createAnalyticsKit({ analytics, errorLog: createFakeErrorLog() });
    function Screen(): React.JSX.Element {
      return <View />;
    }
    await renderRouterWithProviders(
      { _layout: layoutWith(kit), index: Screen, 'tasks/[id]': Screen },
      { initialUrl: '/tasks/42' },
    );
    expect(analytics.events()).toStrictEqual([
      { name: 'screen_view', props: { screen: 'tasks/[id]' } },
    ]);
  });

  it('hands features the port through its provider', async () => {
    const analytics = createFakeAnalytics();
    const kit = createAnalyticsKit({ analytics, errorLog: createFakeErrorLog() });
    function Screen(): React.JSX.Element {
      const isKitPort = useAnalytics() === analytics;
      return <View testID={isKitPort ? 'tasks.kit-analytics' : 'tasks.other-analytics'} />;
    }
    await renderRouterWithProviders({ _layout: layoutWith(kit), index: Screen });
    expect(screen.getByTestId('tasks.kit-analytics')).toBeOnTheScreen();
  });

  it('flushes queued events on the way to the background', () => {
    const analytics = createFakeAnalytics();
    const flush = jest.spyOn(analytics, 'flush');
    const kit = createAnalyticsKit({ analytics, errorLog: createFakeErrorLog() });
    for (const flusher of kit.flushers ?? []) flusher.flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe('analyticsFlusher', () => {
  it('records a flush that rejects instead of letting it escape', async () => {
    const errorLog = createFakeErrorLog();
    const failure = new Error('offline');
    analyticsFlusher({ flush: () => Promise.reject(failure) }, errorLog).flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(errorLog.recorded).toStrictEqual([{ atMs: 0, source: 'service', error: failure }]);
  });
});
