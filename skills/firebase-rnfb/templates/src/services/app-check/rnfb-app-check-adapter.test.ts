// src/services/app-check/rnfb-app-check-adapter.test.ts
// Runs against the root mock __mocks__/@react-native-firebase/app-check.ts.
import * as appCheck from '@react-native-firebase/app-check';

import { appCheckProviderOptions } from './app-check-providers';
import { createRnfbAppCheckAdapter } from './rnfb-app-check-adapter';

const mocked = jest.mocked(appCheck);

describe('createRnfbAppCheckAdapter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts the configured provider once, with token refresh on', () => {
    const port = createRnfbAppCheckAdapter(appCheckProviderOptions('production'));

    expect(port.start()).toStrictEqual({ ok: true, value: undefined });
    expect(port.start()).toStrictEqual({ ok: true, value: undefined });

    expect(mocked.initializeAppCheck).toHaveBeenCalledTimes(1);
    const options = mocked.initializeAppCheck.mock.calls[0]?.[1];
    expect(options?.isTokenAutoRefreshEnabled).toBe(true);
    expect((options?.provider as { providerOptions: unknown }).providerOptions).toStrictEqual({
      apple: { provider: 'appAttestWithDeviceCheckFallback' },
      android: { provider: 'playIntegrity' },
    });
  });

  it('turns a native failure into a typed failure', () => {
    mocked.initializeAppCheck.mockImplementationOnce(() => {
      throw new Error('provider not linked');
    });

    expect(createRnfbAppCheckAdapter(appCheckProviderOptions('development')).start()).toStrictEqual(
      {
        ok: false,
        error: { kind: 'app-check-start-failed', message: 'provider not linked' },
      },
    );
  });
});
