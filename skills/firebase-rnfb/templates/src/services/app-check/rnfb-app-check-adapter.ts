// src/services/app-check/rnfb-app-check-adapter.ts
// AppCheckPort over React Native Firebase App Check (modular API). The iOS native side also needs the
// "@react-native-firebase/app-check" config plugin in app.config.ts; this file only picks the provider
// and starts it once, with automatic token refresh.
import { getApp } from '@react-native-firebase/app';
import {
  initializeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
} from '@react-native-firebase/app-check';

import { err, ok } from '@/core/result';

import type { AppCheckPort } from './app-check-port';
import type { AppCheckProviderOptions } from './app-check-providers';

export function createRnfbAppCheckAdapter(options: AppCheckProviderOptions): AppCheckPort {
  let isStarted = false;
  return {
    start: () => {
      if (isStarted) {
        return ok(undefined);
      }
      try {
        const provider = new ReactNativeFirebaseAppCheckProvider();
        provider.configure({ apple: { ...options.apple }, android: { ...options.android } });
        initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
        isStarted = true;
        return ok(undefined);
      } catch (error: unknown) {
        return err({
          kind: 'app-check-start-failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
