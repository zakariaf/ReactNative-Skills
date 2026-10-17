// src/services/error-net/error-net.ts
// The global error net: the last line for errors nothing else caught. It chains React Native's global
// handler (uncaught exceptions, fatal or not), turns on Hermes promise-rejection tracking in every
// build (React Native 0.86 turns it on only in development, so release builds drop unhandled
// rejections silently), and keeps reports in a bounded buffer until the error log is connected, so a
// startup error is not lost. Expected failures never reach it: they travel as Result values.
import type { ErrorUtils } from 'react-native';

/** Where the net caught an error. Kebab-case and stable: the error log stores it. */
export type ErrorNetSource = 'global-handler' | 'unhandled-rejection' | 'render';

/** One caught error, as the net hands it to the sink. */
export type ErrorReport = {
  readonly source: ErrorNetSource;
  readonly error: unknown;
  readonly isFatal: boolean;
};

/** Where reports go once the error log is open. Synchronous: a fatal error ends the process next. */
export type ErrorSink = (report: ErrorReport) => void;

/** The options Hermes' `HermesInternal.enablePromiseRejectionTracker` takes. */
export type RejectionTrackerOptions = {
  readonly allRejections: boolean;
  readonly onUnhandled: (id: number, rejection: unknown) => void;
  readonly onHandled: (id: number) => void;
};

/** The global hooks the net installs into; tests pass fakes. */
export type ErrorNetHooks = {
  readonly errorUtils: Pick<ErrorUtils, 'getGlobalHandler' | 'setGlobalHandler'> | null;
  readonly enableRejectionTracker: ((options: RejectionTrackerOptions) => void) | null;
  /** Last resort when the sink itself throws; console.error reaches the native log in release. */
  readonly fallbackLog: (message: string, error: unknown) => void;
};

export type ErrorNetOptions = {
  /** Reports kept before the sink is connected; the oldest are dropped first. */
  readonly bufferSize: number;
};

/** The app's error net: install once at startup, connect the error log when it exists. */
export type ErrorNet = {
  /** Installs the handlers (idempotent) and returns the function that restores the previous ones. */
  readonly install: () => () => void;
  /** Connects the sink and flushes the buffered reports, oldest first. */
  readonly connect: (sink: ErrorSink) => void;
  /** Reports an error caught elsewhere (an error boundary). Never throws. */
  readonly report: (report: ErrorReport) => void;
};

/** The globals React Native and Hermes put on `globalThis`, as far as the net needs them. */
export type GlobalErrorScope = {
  readonly ErrorUtils?: Pick<ErrorUtils, 'getGlobalHandler' | 'setGlobalHandler'>;
  readonly HermesInternal?: {
    readonly enablePromiseRejectionTracker?: (options: RejectionTrackerOptions) => void;
  };
};

type Queue = Pick<ErrorNet, 'connect' | 'report'>;

/** Buffers reports until a sink is connected; a throwing sink never escapes. */
function createQueue(options: ErrorNetOptions, fallbackLog: ErrorNetHooks['fallbackLog']): Queue {
  const pending: ErrorReport[] = [];
  let sink: ErrorSink | null = null;
  const deliver = (target: ErrorSink, report: ErrorReport): void => {
    try {
      target(report);
    } catch (sinkError: unknown) {
      fallbackLog('error-net: the error sink threw', sinkError);
    }
  };
  return {
    connect: (next) => {
      sink = next;
      for (const report of pending.splice(0)) deliver(next, report);
    },
    report: (report) => {
      if (sink !== null) {
        deliver(sink, report);
        return;
      }
      pending.push(report);
      if (pending.length > options.bufferSize) pending.shift();
    },
  };
}

type Forward = (error: unknown, isFatal: boolean) => void;

/** The net's handler remembers the handler it chained, so a re-created net (fast refresh) replaces it. */
const CHAINED = Symbol.for('error-net.chained-handler');
type MarkedHandler = Forward & { readonly [CHAINED]?: Forward };

/** Chains the global handler: record first, then React Native's own (LogBox in dev, crash if fatal). */
function installGlobalHandler(
  errorUtils: NonNullable<ErrorNetHooks['errorUtils']>,
  report: ErrorNet['report'],
): { readonly previous: Forward; readonly restore: () => void } {
  const current: MarkedHandler = errorUtils.getGlobalHandler();
  const previous = current[CHAINED] ?? current;
  const handler = (error: unknown, isFatal?: boolean): void => {
    const isFatalError = isFatal === true;
    report({ source: 'global-handler', error, isFatal: isFatalError });
    previous(error, isFatalError);
  };
  Object.defineProperty(handler, CHAINED, { value: previous });
  errorUtils.setGlobalHandler(handler);
  return {
    previous,
    restore: () => {
      errorUtils.setGlobalHandler(previous);
    },
  };
}

/** Records every unhandled rejection, then shows it the way React Native's dev tracker does. */
function rejectionOptions(
  report: ErrorNet['report'],
  forward: Forward | null,
): RejectionTrackerOptions {
  return {
    allRejections: true,
    onUnhandled: (_id, rejection) => {
      report({ source: 'unhandled-rejection', error: rejection, isFatal: false });
      forward?.(rejection, false);
    },
    // A rejection handled late was already recorded; one entry per failure is enough.
    onHandled: () => undefined,
  };
}

/** Creates the net. Nothing is installed until `install()` runs (install-error-net.ts calls it). */
export function createErrorNet(hooks: ErrorNetHooks, options: ErrorNetOptions): ErrorNet {
  const queue = createQueue(options, hooks.fallbackLog);
  let uninstall: (() => void) | null = null;
  const install = (): (() => void) => {
    if (uninstall !== null) return uninstall;
    const chained = hooks.errorUtils ? installGlobalHandler(hooks.errorUtils, queue.report) : null;
    let isActive = true;
    const report: ErrorNet['report'] = (entry) => {
      if (isActive) queue.report(entry);
    };
    hooks.enableRejectionTracker?.(rejectionOptions(report, chained?.previous ?? null));
    uninstall = () => {
      isActive = false;
      chained?.restore();
      uninstall = null;
    };
    return uninstall;
  };
  return { install, connect: queue.connect, report: queue.report };
}

/** Reads the hooks from the JS global scope; a missing hook (web, a non-Hermes engine) is null. */
export function readGlobalErrorHooks(scope: GlobalErrorScope): ErrorNetHooks {
  const hermes = scope.HermesInternal;
  const tracker = hermes?.enablePromiseRejectionTracker;
  return {
    errorUtils: scope.ErrorUtils ?? null,
    // Called as a method of HermesInternal, the way React Native calls it.
    enableRejectionTracker:
      tracker === undefined
        ? null
        : (options) => {
            tracker.call(hermes, options);
          },
    fallbackLog: (message, error) => {
      console.error(message, error);
    },
  };
}
