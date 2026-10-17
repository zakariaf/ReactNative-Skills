// src/services/crash-reporter/crash-reporting-root-kit.test.tsx
import { act } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { View } from 'react-native';

import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { createCrashReportingKit, fixedCrashConsent } from './crash-reporting-root-kit';
import { createFakeCrashReporter } from './fake-crash-reporter';

import type { CrashConsentSource } from './crash-reporting-root-kit';
import type { RootKit } from '@/services/root-kits/root-kit';

/** A consent source the test flips, like the settings store's crashReportsEnabled field. */
function switchableConsent(isInitiallyGranted: boolean): CrashConsentSource & {
  readonly set: (isNowGranted: boolean) => void;
} {
  let isOn = isInitiallyGranted;
  const listeners = new Set<() => void>();
  return {
    isGranted: () => isOn,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set: (isNowGranted) => {
      isOn = isNowGranted;
      for (const listener of listeners) listener();
    },
  };
}

/** The root layout's part that matters here: the kit's effects beside the navigator (RootKits). */
function layoutWith(kit: RootKit): () => React.JSX.Element {
  return function KitLayout(): React.JSX.Element {
    return (
      <>
        <Slot />
        {kit.effects}
      </>
    );
  };
}

function Screen(): React.JSX.Element {
  return <View />;
}

describe('createCrashReportingKit', () => {
  it('forwards render errors and rejections only', () => {
    const crashReporter = createFakeCrashReporter();
    crashReporter.setConsent(true);
    const kit = createCrashReportingKit({ crashReporter, consent: fixedCrashConsent(false) });
    kit.forward?.({ source: 'global-handler', error: new Error('uncaught'), isFatal: true });
    kit.forward?.({ source: 'render', error: new Error('render'), isFatal: false });
    expect(crashReporter.sent.map((report) => report.context.source)).toStrictEqual(['render']);
  });

  it('stays off while the person has not said yes, so nothing leaves the device', async () => {
    const crashReporter = createFakeCrashReporter();
    const kit = createCrashReportingKit({ crashReporter, consent: fixedCrashConsent(false) });
    await renderRouterWithProviders({ _layout: layoutWith(kit), index: Screen });
    kit.forward?.({ source: 'render', error: new Error('render'), isFatal: false });
    expect(crashReporter.consents).toStrictEqual([false]);
    expect(crashReporter.sent).toStrictEqual([]);
  });

  it('applies a yes after the splash and follows every change of the choice', async () => {
    const crashReporter = createFakeCrashReporter();
    const consent = switchableConsent(true);
    const kit = createCrashReportingKit({ crashReporter, consent });
    await renderRouterWithProviders(
      { _layout: layoutWith(kit), index: Screen, 'tasks/[id]': Screen },
      { initialUrl: '/tasks/42' },
    );
    expect(crashReporter.consents).toStrictEqual([true]);
    expect(crashReporter.breadcrumbs).toStrictEqual([
      { category: 'navigation', message: 'tasks/[id]' },
    ]);
    await act(() => {
      consent.set(false);
    });
    expect(crashReporter.consents).toStrictEqual([true, false]);
  });
});
