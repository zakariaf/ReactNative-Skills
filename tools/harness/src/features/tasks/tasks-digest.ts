// src/features/tasks/tasks-digest.ts
// The daily digest plan: which open tasks are overdue, due today or upcoming on one civil date, and
// the identifier the digest notification is scheduled under. Pure: no clock, no Intl, no I/O. The
// caller reads today's date key from the clock service and applies localized text at the edge.

/** One task as the digest sees it. `dueKey` is a civil date 'YYYY-MM-DD', or null. */
export type DigestTask = {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
  readonly dueKey: string | null;
};

/** One day's digest: the open tasks in three groups (each by due date, then id) and the done count. */
export type DigestPlan = {
  readonly overdue: readonly DigestTask[];
  readonly dueToday: readonly DigestTask[];
  readonly upcoming: readonly DigestTask[];
  readonly doneCount: number;
};

/** Orders keys with `<` (never localeCompare: the order must not depend on the device's locale); null last. */
function compareKeys(first: string | null, second: string | null): number {
  if (first === second) {
    return 0;
  }
  if (first === null) {
    return 1;
  }
  if (second === null) {
    return -1;
  }
  return first < second ? -1 : 1;
}

function byDueThenId(first: DigestTask, second: DigestTask): number {
  const byDue = compareKeys(first.dueKey, second.dueKey);
  return byDue === 0 ? compareKeys(first.id, second.id) : byDue;
}

/** The digest of `tasks` on `todayKey`. Civil date keys compare as strings in calendar order. */
export function planDigest(tasks: readonly DigestTask[], todayKey: string): DigestPlan {
  const open = tasks.filter((task) => !task.isDone).sort(byDueThenId);
  return {
    overdue: open.filter((task) => task.dueKey !== null && task.dueKey < todayKey),
    dueToday: open.filter((task) => task.dueKey === todayKey),
    upcoming: open.filter((task) => task.dueKey === null || task.dueKey > todayKey),
    doneCount: tasks.length - open.length,
  };
}

/**
 * The identifier the digest notification of list `listId` on `dateKey` is scheduled under. A
 * compatibility contract: an installed version cancels and replaces an earlier digest by this exact
 * string, so the format never changes; a new format is a new function plus a migration of the
 * notifications already scheduled.
 */
export function digestNotificationId(listId: string, dateKey: string): string {
  return `digest:${listId}:${dateKey}`;
}
