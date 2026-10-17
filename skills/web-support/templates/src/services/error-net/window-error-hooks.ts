// src/services/error-net/window-error-hooks.ts
// The error net's hooks in a browser (web-support). react-native-web has no ErrorUtils and no
// HermesInternal, so uncaught errors and unhandled rejections arrive as `error` and
// `unhandledrejection` events on window instead. This module adapts the two events to the
// ErrorNetHooks shape the canonical error net installs into, so error-net.ts stays one file for
// every platform and only the hooks differ (app-error-net.web.ts passes them in).
import type { ErrorNetHooks, RejectionTrackerOptions } from './error-net';

/** The part of `window` the hooks use; tests pass a plain EventTarget. */
export type WindowErrorTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

type ErrorUtilsHooks = NonNullable<ErrorNetHooks['errorUtils']>;
type GlobalHandler = ReturnType<ErrorUtilsHooks['getGlobalHandler']>;

/** An `error` event carries the thrown value; a script error from another origin has only a message. */
function thrownValueOf(event: Event): unknown {
  const error: unknown = Reflect.get(event, 'error');
  return error ?? Reflect.get(event, 'message');
}

/**
 * ErrorUtils over window's `error` event. The browser has no handler to chain to: it prints the
 * error to the console by itself, so the "previous" handler is a no-op. Installing a handler adds the
 * listener; restoring the no-op (the net's uninstall) removes it.
 */
function windowErrorUtils(target: WindowErrorTarget): ErrorUtilsHooks {
  const browserDefault: GlobalHandler = () => undefined;
  let handler: GlobalHandler = browserDefault;
  const onError = (event: Event): void => {
    // The page keeps running after an uncaught error in a browser: never fatal.
    handler(thrownValueOf(event), false);
  };
  return {
    getGlobalHandler: () => handler,
    setGlobalHandler: (next) => {
      if (next === browserDefault) target.removeEventListener('error', onError);
      else if (handler === browserDefault) target.addEventListener('error', onError);
      handler = next;
    },
  };
}

/** The tracker over window's `unhandledrejection` event. */
function windowRejectionTracker(
  target: WindowErrorTarget,
): (options: RejectionTrackerOptions) => void {
  let nextId = 0;
  return (options) => {
    // app-lifetime: like Hermes' tracker, this one is never turned off; the net's uninstall stops its reports.
    target.addEventListener('unhandledrejection', (event) => {
      nextId += 1;
      options.onUnhandled(nextId, Reflect.get(event, 'reason'));
    });
  };
}

/**
 * The error net's hooks for a browser window, or for no window at all: while Expo renders static
 * HTML in Node there is no window, and the net then installs nothing.
 */
export function readWindowErrorHooks(target: WindowErrorTarget | undefined): ErrorNetHooks {
  return {
    errorUtils: target === undefined ? null : windowErrorUtils(target),
    enableRejectionTracker: target === undefined ? null : windowRejectionTracker(target),
    fallbackLog: (message, error) => {
      console.error(message, error);
    },
  };
}
