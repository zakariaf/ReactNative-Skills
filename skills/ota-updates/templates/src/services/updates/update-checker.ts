// src/services/updates/update-checker.ts
// When the app looks for an update on its own, and what it does with one (the ota-updates skill).
// The native updater already checks at every cold start (checkAutomatically ON_LOAD) and runs a
// download at the next one; this service adds a throttled check when the app returns to the
// foreground, so a phone that stays in the background for days still gets the fix. A downloaded
// update waits for the next cold start, or for the person's tap on "Restart to update" (applyNow):
// the app never reloads under someone's hands. Before that restart it awaits an optional
// `beforeApply` (crash-reporting-and-observability's flush), bounded by a deadline, so queued crash
// events are sent instead of lost. Created once by the composition root; never rejects.
import { attemptAsync, err } from '@/core/result';
import { withTimeout } from '@/services/async/with-timeout';

import type { Result } from '@/core/result';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { UpdatesFailure, UpdatesPort } from '@/services/updates/updates-port';

/** idle: nothing to do · checking/downloading: in flight · ready: runs at the next cold start. */
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready';

/** Expo asks apps to check at launch and on return to the foreground, never in a loop. */
export const DEFAULT_MIN_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** The longest a restart waits for `beforeApply`; the person tapped and is waiting. */
export const BEFORE_APPLY_TIMEOUT_MS = 2_000;

export type UpdateCheckerDeps = {
  readonly updates: UpdatesPort;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: ErrorLogPort;
  readonly minIntervalMs?: number;
  /**
   * Work that must finish before the reload, such as `() => services.crashReporter.flush()`. Waited
   * for at most `beforeApplyTimeoutMs`; a rejection or a timeout is logged and the update still runs.
   */
  readonly beforeApply?: () => Promise<unknown>;
  readonly beforeApplyTimeoutMs?: number;
};

export type UpdateChecker = {
  /** Records an emergency launch (a broken update fell back to the embedded bundle). Once. */
  readonly reportLaunch: () => void;
  /** Starts a check unless one ran within the interval, is running, or an update is ready. */
  readonly checkWhenDue: () => void;
  readonly status: () => UpdateStatus;
  /** For useSyncExternalStore: returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Restarts on the downloaded update; only from the person's action. */
  readonly applyNow: () => Promise<Result<void, UpdatesFailure | { readonly kind: 'not-ready' }>>;
};

/** The checker's mutable state, behind functions so nothing outside this factory writes it. */
type CheckerState = {
  readonly status: () => UpdateStatus;
  /** Moves to `next` and tells every listener; a listener that throws is logged, not propagated. */
  readonly setStatus: (next: UpdateStatus) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** Records a start at `nowMs` and returns true when idle and the interval has passed. */
  readonly startIfDue: (nowMs: number, minIntervalMs: number) => boolean;
  /** True on the first call only. */
  readonly firstLaunchReport: () => boolean;
};

function createCheckerState(errorLog: ErrorLogPort): CheckerState {
  const listeners = new Set<() => void>();
  let status: UpdateStatus = 'idle';
  let lastStartMs: number | null = null;
  let wasLaunchReported = false;
  const notify = (listener: () => void): void => {
    try {
      listener();
    } catch (thrown: unknown) {
      errorLog.record('service', thrown);
    }
  };
  return {
    status: () => status,
    setStatus: (next) => {
      status = next;
      listeners.forEach(notify);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    startIfDue: (nowMs, minIntervalMs) => {
      const isDue = lastStartMs === null || nowMs - lastStartMs >= minIntervalMs;
      if (status !== 'idle' || !isDue) return false;
      lastStartMs = nowMs;
      return true;
    },
    firstLaunchReport: () => {
      const isFirst = !wasLaunchReported;
      wasLaunchReported = true;
      return isFirst;
    },
  };
}

/** A disabled updater (development build, Expo Go) is expected; anything else is worth a log line. */
function settleFailure(
  deps: UpdateCheckerDeps,
  state: CheckerState,
  failure: UpdatesFailure,
): void {
  if (failure.kind !== 'disabled') {
    deps.errorLog.record('service', new Error(`updates: ${failure.kind}`));
  }
  state.setStatus('idle');
}

async function checkAndDownload(deps: UpdateCheckerDeps, state: CheckerState): Promise<void> {
  state.setStatus('checking');
  const checked = await deps.updates.check();
  if (!checked.ok) {
    settleFailure(deps, state, checked.error);
    return;
  }
  if (checked.value === 'none') {
    state.setStatus('idle');
    return;
  }
  state.setStatus('downloading');
  const downloaded = await deps.updates.download();
  if (!downloaded.ok) {
    settleFailure(deps, state, downloaded.error);
    return;
  }
  state.setStatus(downloaded.value === 'ready' ? 'ready' : 'idle');
}

function startCheckWhenDue(deps: UpdateCheckerDeps, state: CheckerState): void {
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_CHECK_INTERVAL_MS;
  if (!state.startIfDue(deps.clock.nowMs(), minIntervalMs)) return;
  checkAndDownload(deps, state).catch((thrown: unknown) => {
    deps.errorLog.record('service', thrown);
    state.setStatus('idle');
  });
}

function reportEmergencyLaunch(deps: UpdateCheckerDeps, state: CheckerState): void {
  if (!state.firstLaunchReport()) return;
  const running = deps.updates.running();
  if (!running.isEmergencyLaunch) return;
  const reason = running.emergencyLaunchReason ?? 'no reason given';
  deps.errorLog.record('startup', new Error(`updates: emergency launch (${reason})`));
}

/** Awaits deps.beforeApply within its deadline; never rejects (a failure is logged, not fatal). */
async function runBeforeApply(deps: UpdateCheckerDeps): Promise<void> {
  const { beforeApply } = deps;
  if (beforeApply === undefined) return;
  const settled = await withTimeout(
    () => attemptAsync(beforeApply, (thrown: unknown) => thrown),
    deps.beforeApplyTimeoutMs ?? BEFORE_APPLY_TIMEOUT_MS,
  );
  if (!settled.ok) {
    const { error } = settled;
    const isTimeout = typeof error === 'object' && error !== null && 'kind' in error;
    deps.errorLog.record(
      'service',
      isTimeout ? new Error('updates: beforeApply timed out; restarting anyway') : error,
    );
  }
}

async function applyWhenReady(
  deps: UpdateCheckerDeps,
  state: CheckerState,
): Promise<Result<void, UpdatesFailure | { readonly kind: 'not-ready' }>> {
  if (state.status() !== 'ready') return err({ kind: 'not-ready' });
  await runBeforeApply(deps);
  return deps.updates.apply();
}

export function createUpdateChecker(deps: UpdateCheckerDeps): UpdateChecker {
  const state = createCheckerState(deps.errorLog);
  return {
    reportLaunch: () => {
      reportEmergencyLaunch(deps, state);
    },
    checkWhenDue: () => {
      startCheckWhenDue(deps, state);
    },
    status: state.status,
    subscribe: state.subscribe,
    applyNow: () => applyWhenReady(deps, state),
  };
}
