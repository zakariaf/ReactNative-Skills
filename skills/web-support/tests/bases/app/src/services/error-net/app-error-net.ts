// src/services/error-net/app-error-net.ts
import { createErrorNet, readGlobalErrorHooks } from './error-net';

export const appErrorNet = createErrorNet(readGlobalErrorHooks(globalThis), { bufferSize: 50 });
