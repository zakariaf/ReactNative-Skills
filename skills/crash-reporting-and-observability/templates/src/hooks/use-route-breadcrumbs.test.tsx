// src/hooks/use-route-breadcrumbs.test.tsx
import { Slot } from 'expo-router';
import { View } from 'react-native';

import { createFakeCrashReporter } from '@/services/crash-reporter/fake-crash-reporter';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { useRouteBreadcrumbs } from './use-route-breadcrumbs';

import type { FakeCrashReporter } from '@/services/crash-reporter/fake-crash-reporter';

function layoutRecordingTo(crashReporter: FakeCrashReporter): () => React.JSX.Element {
  return function RecordingLayout(): React.JSX.Element {
    useRouteBreadcrumbs(crashReporter);
    return <Slot />;
  };
}

function Screen(): React.JSX.Element {
  return <View />;
}

describe('useRouteBreadcrumbs', () => {
  it('records the route pattern, never the id in the path', async () => {
    const crashReporter = createFakeCrashReporter();
    crashReporter.setConsent(true);
    await renderRouterWithProviders(
      { _layout: layoutRecordingTo(crashReporter), index: Screen, 'tasks/[id]': Screen },
      { initialUrl: '/tasks/42' },
    );
    expect(crashReporter.breadcrumbs).toStrictEqual([
      { category: 'navigation', message: 'tasks/[id]' },
    ]);
    expect(JSON.stringify(crashReporter.breadcrumbs)).not.toContain('42');
  });
});
