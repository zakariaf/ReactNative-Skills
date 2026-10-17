// src/features/root-navigator/hold-splash.ts
// Imported only for its side effect, by the root layout right after the error net:
// `import '@/features/root-navigator/hold-splash';`. It keeps the native splash on screen until
// AppRoot releases it (useStartupReady), so the first thing the person sees after the splash is the
// real first screen: never an empty frame, never the moment before a direction restart. It must run
// at module scope: called from a component or an effect it comes after native content appeared, when
// iOS and Android may already have hidden the splash (Expo's splash-screen docs, SDK 57). It is the one
// piece of startup work allowed at import time, because it opens nothing and is safe to repeat: a
// reload runs it again and the splash stays up until the next release.
import { preventAutoHideAsync } from 'expo-splash-screen';

import { appErrorNet } from '@/services/error-net/app-error-net';

// expo-splash-screen 57.0.9 resolves on iOS and Android (true) and on web or without the native
// module (no splash to hold); a rejection would be a library bug, so it goes to the error net, which
// buffers it until the error log is connected.
preventAutoHideAsync().catch((error: unknown) => {
  appErrorNet.report({ source: 'unhandled-rejection', error, isFatal: false });
});
