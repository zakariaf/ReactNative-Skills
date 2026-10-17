// src/services/error-net/app-error-net.ts
// The app's one error net. install-error-net.ts installs it (the root layout's first app import);
// the composition root calls appErrorNet.connect(sink) once the error log is open; an error boundary
// calls appErrorNet.report(...). Creating it reads the global hooks and installs nothing.
import { createErrorNet, readGlobalErrorHooks } from './error-net';

import type { GlobalErrorScope } from './error-net';

/** React Native and Hermes define these globals at runtime; the type system does not know them. */
const globalScope: GlobalErrorScope = globalThis as GlobalErrorScope;

/** The app's error net (install first, connect when the error log exists). */
export const appErrorNet = createErrorNet(readGlobalErrorHooks(globalScope), { bufferSize: 50 });
