// src/hooks/use-crash-reporting-consent.test.ts
// no-providers: the hook reads no context; the reporter is passed in as an argument.
import { renderHook } from '@testing-library/react-native';

import { createFakeCrashReporter } from '@/services/crash-reporter/fake-crash-reporter';

import { useCrashReportingConsent } from './use-crash-reporting-consent';

import type { CrashReportingConsentInput } from './use-crash-reporting-consent';

describe('useCrashReportingConsent', () => {
  it('applies nothing while the splash is up, then the choice and every change', async () => {
    const crashReporter = createFakeCrashReporter();
    const view = await renderHook(
      (input: CrashReportingConsentInput) => {
        useCrashReportingConsent(crashReporter, input);
      },
      { initialProps: { isReady: false, isGranted: true } },
    );
    expect(crashReporter.consents).toStrictEqual([]);

    await view.rerender({ isReady: true, isGranted: true });
    expect(crashReporter.consents).toStrictEqual([true]);

    await view.rerender({ isReady: true, isGranted: false });
    expect(crashReporter.consents).toStrictEqual([true, false]);
    expect(crashReporter.status()).toBe('off');
  });
});
