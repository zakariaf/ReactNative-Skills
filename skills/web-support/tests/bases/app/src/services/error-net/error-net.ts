// src/services/error-net/error-net.ts (the canonical net, shortened for the fixture)
export type ErrorReport = { readonly source: string; readonly error: unknown; readonly isFatal: boolean };
export type ErrorNetHooks = { readonly errorUtils: unknown; readonly enableRejectionTracker: unknown; readonly fallbackLog: (message: string, error: unknown) => void };
export type RejectionTrackerOptions = { readonly onUnhandled: (id: number, rejection: unknown) => void };

export function createErrorNet(hooks: ErrorNetHooks, options: { readonly bufferSize: number }) {
  return { hooks, options, install: () => () => undefined, connect: () => undefined, report: (report: ErrorReport) => report };
}

/** Reads the hooks from the JS global scope; a missing hook (web, a non-Hermes engine) is null. */
export function readGlobalErrorHooks(scope: { readonly ErrorUtils?: unknown }): ErrorNetHooks {
  return { errorUtils: scope.ErrorUtils ?? null, enableRejectionTracker: null, fallbackLog: () => undefined };
}
