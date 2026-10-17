// src/services/local-notifications/reminder-sync.ts
// The one idempotent sync: the only code that schedules or cancels reminder notifications. Each
// run reads the reminders from the database (the source of truth), plans the nearest occurrences
// in the current zone and language, diffs the plan against the identifiers the OS has pending, and
// applies the diff. The OS pending set is a cache: losing it (a restore, a reinstall, the person
// clearing notifications, an OEM killing alarms) costs nothing, because the next run rebuilds it.
// Without the permission a run still cancels what the plan no longer holds (a deleted row, a sign-
// out), so stale text cannot fire after the person allows notifications again; it schedules nothing.
// The language is explicit: useReminderSync passes the t() the app shows, every run builds its
// channels and texts from the last one passed (one t() per run), and runs before any was passed use
// translateNow(). Runs never overlap: a request while one runs schedules exactly one more run.
import { planReminders } from '@/core/reminders/plan-reminders';
import { reconcileReminders } from '@/core/reminders/reconcile-reminders';
import { err, ok } from '@/core/result';
import { isNotificationAllowed } from '@/services/local-notifications/local-notifications-port';

import type { PlanResult, RejectedReminder } from '@/core/reminders/plan-reminders';
import type { ReminderDiff } from '@/core/reminders/reconcile-reminders';
import type { Reminder } from '@/core/reminders/reminder';
import type { Result } from '@/core/result';
import type { TFunction } from '@/i18n/create-t';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type {
  LocalNotificationsPort,
  NotificationPermission,
} from '@/services/local-notifications/local-notifications-port';
import type { ReminderTexts } from '@/services/local-notifications/reminder-texts';
import type { LocalZonePort } from '@/services/local-zone/local-zone-port';

/** Why the reminders could not be read; the repository's own failure kinds map to this. */
export type ReminderLoadFailure = { readonly kind: 'storage-unavailable' };

export type ReminderSyncDeps = {
  readonly notifications: LocalNotificationsPort;
  readonly zone: LocalZonePort;
  readonly clock: ClockPort;
  readonly errorLog: ErrorLogPort;
  /** Every active reminder row (the repository). */
  readonly loadReminders: () => Promise<Result<readonly Reminder[], ReminderLoadFailure>>;
  /** The channels and texts of one run, from one t() (reminderTexts). */
  readonly texts: (t: TFunction) => ReminderTexts;
  /**
   * The t() of runs before the app passed one (createTranslateNow): useful only for a run that
   * starts before useReminderSync has mounted.
   */
  readonly translateNow: () => TFunction;
  /** Plan size, at most 64; default DEFAULT_MAX_PENDING. */
  readonly maxPending?: number;
};

export type ReminderSyncOutcome =
  | {
      readonly kind: 'synced';
      readonly scheduled: number;
      readonly cancelled: number;
      readonly pending: number;
      readonly rejected: readonly RejectedReminder[];
      /** Identifiers the OS refused; the next run tries them again. */
      readonly refused: readonly string[];
    }
  /**
   * Nothing scheduled: the OS would not show it. Reminder identifiers the plan no longer holds are
   * still cancelled (`cancelled`); the next run after a grant schedules the rest.
   */
  | {
      readonly kind: 'not-allowed';
      readonly permission: NotificationPermission;
      readonly cancelled: number;
    }
  | { readonly kind: 'failed'; readonly step: 'load' | 'pending' | 'unexpected' };

/** `t`: the t() the app shows now; this run and every later one use it until another is passed. */
export type ReminderSyncRequest = { readonly t?: TFunction };

export type ReminderSync = {
  /** Brings the OS pending set in line with the database; resolves when that run has finished. */
  readonly sync: (request?: ReminderSyncRequest) => Promise<ReminderSyncOutcome>;
  /**
   * Starts a sync and returns at once: after a reminder write commits (no argument), and from
   * useReminderSync (with the t() the app shows).
   */
  readonly request: (request?: ReminderSyncRequest) => void;
  /**
   * Turns reminders on from a person's action ("Remind me"): channels first (an app targeting
   * Android 12L or lower gets no prompt before one exists), then the system prompt if the OS still
   * allows it, then a sync. After permissions-and-system-prompts' gate allowed, it never prompts.
   */
  readonly enable: () => Promise<NotificationPermission>;
};

type Planned = Result<PlanResult, ReminderSyncOutcome>;

/** Reads the rows (the source of truth) and plans them in the current zone and in `texts`. */
async function loadAndPlan(deps: ReminderSyncDeps, texts: ReminderTexts): Promise<Planned> {
  const loaded = await deps.loadReminders();
  if (!loaded.ok) {
    deps.errorLog.record('storage', new Error(`reminder sync: ${loaded.error.kind}`));
    return err({ kind: 'failed', step: 'load' });
  }
  return ok(
    planReminders({
      reminders: loaded.value,
      nowMs: deps.clock.nowMs(),
      today: deps.clock.today(),
      offsetAt: deps.zone.offsetAt,
      channelIds: texts.channels.map(({ id }) => id),
      describe: texts.describe,
      ...(deps.maxPending === undefined ? {} : { maxPending: deps.maxPending }),
    }),
  );
}

/** The diff between the plan and the pending identifiers, or the failed outcome. */
async function diffPending(
  deps: ReminderSyncDeps,
  plan: PlanResult,
): Promise<Result<ReminderDiff, ReminderSyncOutcome>> {
  const pending = await deps.notifications.pendingIds();
  if (!pending.ok) {
    deps.errorLog.record('service', new Error(`reminder sync: ${pending.error.detail}`));
    return err({ kind: 'failed', step: 'pending' });
  }
  return ok(reconcileReminders(plan.notifications, pending.value, plan.imminentIds));
}

/** Without the permission: cancel what the plan no longer holds, schedule nothing. */
async function cancelUnplanned(
  deps: ReminderSyncDeps,
  plan: PlanResult,
  permission: NotificationPermission,
): Promise<ReminderSyncOutcome> {
  const diff = await diffPending(deps, plan);
  if (!diff.ok) return diff.error;
  if (diff.value.cancel.length > 0) await deps.notifications.cancelNotifications(diff.value.cancel);
  return { kind: 'not-allowed', permission, cancelled: diff.value.cancel.length };
}

/** Diffs the plan against the pending identifiers and applies the diff. */
async function applyPlan(deps: ReminderSyncDeps, plan: PlanResult): Promise<ReminderSyncOutcome> {
  const { notifications, errorLog } = deps;
  const diffed = await diffPending(deps, plan);
  if (!diffed.ok) return diffed.error;
  const diff = diffed.value;
  await notifications.cancelNotifications(diff.cancel);
  const refusals = await notifications.scheduleNotifications(diff.schedule);
  for (const { id, failure } of refusals) {
    errorLog.record('service', new Error(`reminder ${id}: ${failure.detail}`));
  }
  if (plan.rejected.length > 0) {
    const rows = plan.rejected.map((row) => `${row.reminderId} (${row.problem})`).join(', ');
    errorLog.record('service', new Error(`reminder rows not planned: ${rows}`));
  }
  return {
    kind: 'synced',
    scheduled: diff.schedule.length - refusals.length,
    cancelled: diff.cancel.length,
    pending: plan.notifications.length - refusals.length,
    rejected: plan.rejected,
    refused: refusals.map(({ id }) => id),
  };
}

/** One run in one language: channels, permission, plan, diff. Never rejects. */
async function runOnce(deps: ReminderSyncDeps, t: () => TFunction): Promise<ReminderSyncOutcome> {
  try {
    const texts = deps.texts(t());
    await deps.notifications.syncChannels(texts.channels);
    const permission = await deps.notifications.permission();
    const planned = await loadAndPlan(deps, texts);
    if (!planned.ok) return planned.error;
    if (!isNotificationAllowed(permission)) {
      return await cancelUnplanned(deps, planned.value, permission);
    }
    return await applyPlan(deps, planned.value);
  } catch (thrown: unknown) {
    // A port that broke its promise not to reject: record it, keep the app running.
    deps.errorLog.record('service', thrown);
    return { kind: 'failed', step: 'unexpected' };
  }
}

/**
 * Runs `task` one at a time: a call while it runs waits for exactly one more run after it, shared by
 * every caller in the meantime, so a burst of requests costs at most two runs.
 */
function singleFlight<TValue>(task: () => Promise<TValue>): () => Promise<TValue> {
  let running: Promise<TValue> | null = null;
  let queued: Promise<TValue> | null = null;
  const start = (): Promise<TValue> => {
    if (running === null) {
      running = task().finally(() => {
        running = null;
      });
      return running;
    }
    queued ??= running.then(() => {
      queued = null;
      return start();
    });
    return queued;
  };
  return start;
}

export function createReminderSync(deps: ReminderSyncDeps): ReminderSync {
  const { notifications, errorLog } = deps;
  let shownT: TFunction | null = null;
  const currentT = (): TFunction => shownT ?? deps.translateNow();
  // A queued run reads currentT() when it starts, so it uses the t() passed last.
  const run = singleFlight(() => runOnce(deps, currentT));
  const sync = (request: ReminderSyncRequest = {}): Promise<ReminderSyncOutcome> => {
    if (request.t !== undefined) shownT = request.t;
    return run();
  };
  return {
    sync,
    request: (request) => {
      sync(request).catch((thrown: unknown) => {
        errorLog.record('service', thrown);
      });
    },
    enable: async () => {
      await notifications.syncChannels(deps.texts(currentT()).channels);
      const current = await notifications.permission();
      const isAskable = current === 'undetermined' || current === 'denied';
      const permission = isAskable ? await notifications.requestPermission() : current;
      await sync();
      return permission;
    },
  };
}
