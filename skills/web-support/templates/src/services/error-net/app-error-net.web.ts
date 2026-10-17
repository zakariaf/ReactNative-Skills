// src/services/error-net/app-error-net.web.ts
// The app's one error net in the web build (web-support). Metro picks this file over
// app-error-net.ts when it bundles for the web; iOS and Android keep the canonical file. Same export,
// same net: only the hooks come from window's `error` and `unhandledrejection` events, because
// react-native-web has no ErrorUtils and no HermesInternal. The type import holds this file to the
// native file's export, so tsc fails when the two drift apart.
import { createErrorNet } from './error-net';
import { readWindowErrorHooks } from './window-error-hooks';

import type * as NativeErrorNet from './app-error-net';

/** No window while Expo renders static HTML in Node: the net then installs nothing there. */
const browserWindow = typeof window === 'undefined' ? undefined : window;

/** The app's error net (install first, connect when the error log exists). */
export const appErrorNet: typeof NativeErrorNet.appErrorNet = createErrorNet(
  readWindowErrorHooks(browserWindow),
  { bufferSize: 50 },
);
