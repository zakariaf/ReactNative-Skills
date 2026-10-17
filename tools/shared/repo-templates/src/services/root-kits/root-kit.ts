// src/services/root-kits/root-kit.ts
// The slots of the canonical root skeleton (app-startup-and-bootstrap). An optional kit (crash
// reporting, analytics, local or push notifications, ...) joins the app's startup by returning a
// RootKit from the app's one registry, src/services/create-root-kits.ts, never by editing the root
// files. AppRoot's startApp first lets the registry prepare the ports (prepareRootKits: a test build
// swaps in its simulated clock and network there, before anything reads them), then creates the
// kits once per JS run, after the data layer, the settings and the stores, and hands their parts to
// the slots: the error net's sink (forward), the startup gate (blocking), the background flush
// (flushers) and, in the root stack, the motion config (motion), the test-build route group
// (opensDebugRoutes), the providers (provide) and the effect components (effects). A slot no kit
// fills does nothing, so an app without kits runs the skeleton exactly as before. Pure TypeScript:
// the root files and their tests use it.
import type { Result } from '@/core/result';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { ErrorReport, ErrorSink } from '@/services/error-net/error-net';
import type { MotionConfigProps } from '@/ui/a11y/motion-config';
import type { ReactNode } from 'react';

/** A kit's blocking startup task: the same shape as the startup gate's StartupTask. */
export type KitStartupTask = {
  readonly name: string;
  readonly run: (signal: AbortSignal) => Promise<Result<unknown, { readonly kind: string }>>;
};

/** A kit's buffered writer: the same shape as the background flush's Flusher (synchronous). */
export type KitFlusher = { readonly name: string; readonly flush: () => void };

/** One optional kit, as the root skeleton's slots see it. Every part but the name is optional. */
export type RootKit = {
  /** Kebab-case and unique among the app's kits: the key of its elements and its name in the log. */
  readonly name: string;
  /**
   * Startup step E2: receives every error report after the local error log recorded it, including
   * the ones caught before the kits existed (crash reporting forwards render errors and rejections).
   */
  readonly forward?: (report: ErrorReport) => void;
  /** Step E7: async work the first screen waits for, under the startup gate's one deadline. */
  readonly blocking?: readonly KitStartupTask[];
  /** Step I1: flushed with every other buffered writer when the app leaves the foreground. */
  readonly flushers?: readonly KitFlusher[];
  /**
   * Step F5: takes MotionConfig's place in the root stack (RootMotion) and renders the app's
   * MotionConfig itself, with the preference it is handed or one it decides (a test build holds
   * every animation still while its switch says so). The first kit that has one wins; with none,
   * RootMotion is the plain MotionConfig. Never a second MotionConfig below the first: Reanimated's
   * global reduce-motion mode belongs to exactly one.
   */
  readonly motion?: (props: MotionConfigProps) => ReactNode;
  /**
   * Step F5: opens the root Stack's test-build route group, `(debug)` (debug-menu-and-test-hooks).
   * AppStack keeps the group inside Stack.Protected, closed while no kit opens it, so a production
   * build, whose registry never creates a test-only kit, never registers those routes.
   */
  readonly opensDebugRoutes?: boolean;
  /** Step F5: wraps the root Stack and every kit's effects (a context the kit's hooks read). */
  readonly provide?: (children: ReactNode) => ReactNode;
  /**
   * Step F6: mounted once beside the root Stack, after the splash release and inside every provider:
   * components that render nothing and run the kit's effects (applying a consent, syncing on the
   * way back to the foreground, routing a notification tap, route breadcrumbs, screen views).
   */
  readonly effects?: ReactNode;
};

/** The error net's sink with the kits' forwarding attached once they exist. */
export type KitErrorSink = {
  /** For appErrorNet.connect: records every report, then hands it to each attached kit. */
  readonly sink: ErrorSink;
  /** Attaches the kits once (later calls do nothing) and replays the reports kept until now. */
  readonly attach: (kits: readonly RootKit[]) => void;
};

export type KitErrorSinkOptions = {
  /** Reports kept for the kits before they are attached; the oldest are dropped first. */
  readonly replayLimit?: number;
};

/** As many as the error net buffers before its sink is connected. */
const DEFAULT_REPLAY_LIMIT = 50;

/** Hands one report to one kit; a kit that throws is recorded and the others still receive it. */
function forwardTo(
  kit: RootKit,
  report: ErrorReport,
  errorLog: Pick<ErrorLogPort, 'record'>,
): void {
  try {
    kit.forward?.(report);
  } catch (thrown: unknown) {
    errorLog.record(
      'service',
      new Error(`root kit ${kit.name} failed to forward an error report`, { cause: thrown }),
    );
  }
}

/**
 * The sink startApp connects right after the data layer opens (step E2), before any kit exists:
 * every report reaches the local error log at once, and the kits, attached a few statements later,
 * still receive the reports of the first moments.
 */
export function createKitErrorSink(
  errorLog: Pick<ErrorLogPort, 'record'>,
  { replayLimit = DEFAULT_REPLAY_LIMIT }: KitErrorSinkOptions = {},
): KitErrorSink {
  const early: ErrorReport[] = [];
  let attached: readonly RootKit[] | null = null;
  return {
    sink: (report) => {
      errorLog.record(report.source, report.error);
      if (attached === null) {
        early.push(report);
        if (early.length > replayLimit) early.shift();
        return;
      }
      for (const kit of attached) forwardTo(kit, report, errorLog);
    },
    attach: (kits) => {
      if (attached !== null) return;
      attached = kits;
      const names = kits.map((kit) => kit.name);
      const repeated = names.filter((name, index) => names.indexOf(name) !== index);
      if (repeated.length > 0) {
        errorLog.record('startup', new Error(`root kits share a name: ${repeated.join(', ')}`));
      }
      for (const report of early.splice(0)) {
        for (const kit of kits) forwardTo(kit, report, errorLog);
      }
    },
  };
}

/** Every kit's blocking startup tasks, in registry order, for createStartupGate({ blocking }). */
export function kitBlocking(kits: readonly RootKit[]): readonly KitStartupTask[] {
  return kits.flatMap((kit) => kit.blocking ?? []);
}

/** Every kit's flushers, in registry order, for useFlushOnBackground. */
export function kitFlushers(kits: readonly RootKit[]): readonly KitFlusher[] {
  return kits.flatMap((kit) => kit.flushers ?? []);
}

/** The motion config the first kit with one renders in MotionConfig's place, or null (the plain one). */
export function kitMotion(
  kits: readonly RootKit[],
): ((props: MotionConfigProps) => ReactNode) | null {
  return kits.find((kit) => kit.motion !== undefined)?.motion ?? null;
}

/** Whether a kit opens the `(debug)` route group (only a test build's kit does). */
export function kitsOpenDebugRoutes(kits: readonly RootKit[]): boolean {
  return kits.some((kit) => kit.opensDebugRoutes === true);
}
