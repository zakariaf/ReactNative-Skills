// reminder-checks.mjs: the behaviour check-reminder-logic.mjs proves on an app's own pure reminder
// modules (a helper, not an entry point). Each check names its rule, the modules it needs, the
// export it exercises (for the problem's line), the fix, and optionally `after`: rules that must
// pass first because this check builds on their behaviour. Time zones are data (rule zones checked
// against the IANA database through Node's Intl on 2026-10-14), so the result never depends on the
// machine's zone.

const HOUR = 3_600_000;

/** A zone that starts at `initial` (ms east of UTC) and changes at each [atMs, offsetMs]. */
const ruleZone = (initial, transitions) => (instantMs) => {
  let offset = initial;
  for (const [atMs, offsetMs] of transitions) if (instantMs >= atMs) offset = offsetMs;
  return offset;
};
export const ZONES = {
  utc: () => 0,
  berlin: ruleZone(HOUR, [[Date.UTC(2026, 2, 29, 1), 2 * HOUR], [Date.UTC(2026, 9, 25, 1), HOUR]]),
  newYork: ruleZone(-5 * HOUR, [[Date.UTC(2026, 2, 8, 7), -4 * HOUR], [Date.UTC(2026, 10, 1, 6), -5 * HOUR]]),
  havana: ruleZone(-5 * HOUR, [[Date.UTC(2026, 2, 8, 5), -4 * HOUR]]),
  lordHowe: ruleZone(11 * HOUR, [[Date.UTC(2026, 3, 4, 15), 10.5 * HOUR]]),
};

const NOW = Date.UTC(2026, 9, 14, 8);
const TODAY = '2026-10-14';
const CHANNEL = 'reminders';

const row = (overrides = {}) => ({
  id: 'task-42',
  schedule: { kind: 'daily', minuteOfDay: 540 },
  channelId: CHANNEL,
  label: 'Water the plants',
  skipDays: [],
  ...overrides,
});

const input = (overrides = {}) => ({
  reminders: [row()],
  nowMs: NOW,
  today: TODAY,
  offsetAt: ZONES.utc,
  channelIds: [CHANNEL],
  describe: ({ reminder }) => ({ title: 'Reminder', body: reminder.label }),
  ...overrides,
});

const plan = (m, overrides) => m.plan.planReminders(input(overrides));
const ids = (m, overrides) => plan(m, overrides).notifications.map((n) => n.id);
const times = (m, overrides) => plan(m, overrides).notifications.map((n) => n.fireAtMs);

export const REMINDER_CHECKS = [
  {
    rule: 'wall-clock-dst',
    needs: ['wallClock'],
    fn: 'instantOfWallClock',
    fix: 'Resolve a local day and minute through the zone offset: try the offsets on both sides of the wall time, keep the earliest instant whose offset agrees (the first of a doubled time), and move a skipped time forward by the gap (copy templates/src/core/reminders/wall-clock.ts).',
    run: (m, { strictEqual }) => {
      const at = m.wallClock.instantOfWallClock;
      strictEqual(at('2026-07-15', 540, ZONES.berlin), Date.UTC(2026, 6, 15, 7), 'Berlin 09:00 in July is 07:00 UTC');
      strictEqual(at('2026-03-29', 150, ZONES.berlin), Date.UTC(2026, 2, 29, 1, 30), 'Berlin 02:30 on 29 March 2026 does not exist and becomes 03:30 summer time');
      strictEqual(at('2026-10-25', 150, ZONES.berlin), Date.UTC(2026, 9, 25, 0, 30), 'Berlin 02:30 on 25 October 2026 happens twice: the first (summer time) is meant');
      strictEqual(at('2026-11-01', 90, ZONES.newYork), Date.UTC(2026, 10, 1, 5, 30), 'New York 01:30 on 1 November 2026 happens twice: the first (EDT) is meant');
      strictEqual(at('2026-03-08', 30, ZONES.havana), Date.UTC(2026, 2, 8, 5, 30), 'Havana skips midnight on 8 March 2026: 00:30 becomes 01:30');
      strictEqual(at('2026-04-06', 540, ZONES.lordHowe), Date.UTC(2026, 3, 5, 22, 30), 'Lord Howe 09:00 after its half-hour change is 22:30 UTC the day before');
    },
  },
  {
    rule: 'plan-dst',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Expand a daily or weekly reminder day by day (addDays on the DateKey) and resolve each day\'s wall-clock minute with instantOfWallClock; never add 24 hours to the previous instant.',
    run: (m, { deepStrictEqual }) => {
      const spring = { nowMs: Date.UTC(2026, 2, 27, 12), today: '2026-03-27', offsetAt: ZONES.berlin, horizonDays: 3 };
      deepStrictEqual(times(m, spring), [Date.UTC(2026, 2, 28, 8), Date.UTC(2026, 2, 29, 7)], 'a daily 09:00 in Berlin stays 09:00 across the spring change (a 23-hour day)');
      const autumn = { nowMs: Date.UTC(2026, 9, 24, 0), today: '2026-10-24', offsetAt: ZONES.berlin, horizonDays: 3 };
      deepStrictEqual(times(m, autumn), [Date.UTC(2026, 9, 24, 7), Date.UTC(2026, 9, 25, 8), Date.UTC(2026, 9, 26, 8)], 'a daily 09:00 in Berlin stays 09:00 across the autumn change (a 25-hour day)');
      const summer = { nowMs: Date.UTC(2026, 6, 14, 12), today: '2026-07-14', offsetAt: ZONES.berlin, horizonDays: 3, reminders: [row({ id: 'once', schedule: { kind: 'once', day: '2026-07-15', minuteOfDay: 540 } })] };
      deepStrictEqual(times(m, summer), [Date.UTC(2026, 6, 15, 7)], 'a once reminder at 09:00 on a Berlin summer day fires at 07:00 UTC (its day is resolved through the zone too)');
    },
  },
  {
    rule: 'plan-idempotent',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Build each identifier only from the input: REMINDER_ID_PREFIX + reminder id + the fire instant + a hash of the channel and text; no counter, random value or clock read.',
    run: (m, { deepStrictEqual, ok, strictEqual }) => {
      const reminders = [row(), row({ id: 'task-7', schedule: { kind: 'weekly', isoWeekdays: [1, 5], minuteOfDay: 600 } })];
      const first = ids(m, { reminders });
      deepStrictEqual(ids(m, { reminders }), first, 'the same input plans the same identifiers (the second sync must be a no-op)');
      strictEqual(new Set(first).size, first.length, 'every planned identifier is unique');
      const prefix = m.plan.REMINDER_ID_PREFIX;
      ok(typeof prefix === 'string' && prefix.length > 0, 'plan-reminders exports REMINDER_ID_PREFIX');
      ok(first.every((id) => id.startsWith(prefix)), `every identifier starts with REMINDER_ID_PREFIX (${JSON.stringify(prefix)})`);
    },
  },
  {
    rule: 'plan-edit',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Put the fire instant and a hash of the channel, title and body into the identifier: iOS reports a pending date trigger only as an interval, so an edit that keeps the identifier keeps firing at the old time.',
    run: (m, { ok }) => {
      const base = ids(m, { horizonDays: 1 })[0];
      const moved = ids(m, { horizonDays: 1, reminders: [row({ schedule: { kind: 'daily', minuteOfDay: 600 } })] })[0];
      const retitled = ids(m, { horizonDays: 1, describe: () => ({ title: 'تذكير', body: 'Water the plants' }) })[0];
      const rechannelled = ids(m, { horizonDays: 1, channelIds: [CHANNEL, 'quiet'], reminders: [row({ channelId: 'quiet' })] })[0];
      ok(base !== undefined && moved !== base, 'moving the time plans a new identifier');
      ok(retitled !== base, 'a new text (another language) plans a new identifier');
      ok(rechannelled !== base, 'another channel plans a new identifier');
    },
  },
  {
    rule: 'plan-max-pending',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Sort every occurrence by instant, keep the nearest maxPending (default 50, never above IOS_PENDING_LIMIT = 64: iOS keeps only the soonest 64 and drops the rest without an error) and let the foreground sync refill the window.',
    run: (m, { deepStrictEqual, ok, strictEqual }) => {
      const reminders = Array.from({ length: 30 }, (_, index) => row({ id: `task-${index}`, schedule: { kind: 'daily', minuteOfDay: index * 7 } }));
      const all = times(m, { reminders });
      ok(all.length > 0 && all.length <= 64, `the default plan holds at most 64 notifications (got ${all.length})`);
      deepStrictEqual(all, [...all].sort((a, b) => a - b), 'the plan is nearest first');
      strictEqual(m.plan.IOS_PENDING_LIMIT, 64, 'plan-reminders exports IOS_PENDING_LIMIT = 64');
      const ten = times(m, { reminders, maxPending: 10 });
      deepStrictEqual(ten, all.slice(0, 10), 'maxPending 10 keeps exactly the 10 nearest occurrences');
      let over = null;
      try {
        over = times(m, { reminders, maxPending: 65 });
      } catch {
        over = [];
      }
      ok(over.length <= 64, 'a maxPending above 64 never plans more than 64');
    },
  },
  {
    rule: 'plan-past',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Never schedule an occurrence closer than a few seconds (DEFAULT_MIN_LEAD_MS): iOS rejects a date trigger in the past and Android drops it silently, so the sync would report a failure or lose it. Report one due within the lead in PlanResult.imminentIds instead, so the diff keeps it when it is already pending.',
    run: (m, { ok, deepStrictEqual }) => {
      const nowMs = Date.UTC(2026, 9, 14, 8, 59, 59);
      const reminders = [row(), row({ id: 'now', schedule: { kind: 'at', atMs: nowMs } }), row({ id: 'soon', schedule: { kind: 'at', atMs: nowMs + HOUR } })];
      const planned = plan(m, { reminders, nowMs, horizonDays: 2 }).notifications;
      ok(planned.every((n) => n.fireAtMs > nowMs), 'nothing is planned at or before now');
      deepStrictEqual(planned.map((n) => n.reminderId), ['soon', 'task-42'], 'an occurrence one second ahead and one at now are skipped; later ones are kept');
    },
  },
  {
    rule: 'plan-skip',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Honour the row\'s rule: skipDays stay silent, a weekly rule fires only on its ISO weekdays (isoWeekday from date-key), a once rule only on its day and not when that day is a skip day.',
    run: (m, { deepStrictEqual }) => {
      const reminders = [
        row({ id: 'daily', skipDays: ['2026-10-15'] }),
        row({ id: 'friday', schedule: { kind: 'weekly', isoWeekdays: [5], minuteOfDay: 600 } }),
        row({ id: 'once', schedule: { kind: 'once', day: '2026-10-15', minuteOfDay: 720 } }),
        row({ id: 'once-skipped', schedule: { kind: 'once', day: '2026-10-15', minuteOfDay: 780 }, skipDays: ['2026-10-15'] }),
      ];
      const planned = plan(m, { reminders, horizonDays: 3 }).notifications.map((n) => `${n.reminderId}@${new Date(n.fireAtMs).toISOString().slice(0, 16)}`);
      deepStrictEqual(planned, ['daily@2026-10-14T09:00', 'once@2026-10-15T12:00', 'daily@2026-10-16T09:00', 'friday@2026-10-16T10:00'], 'skip days (also of a once rule), weekdays and one-off days (UTC zone, 14 October 2026 is a Wednesday)');
      const ends = [
        row({ id: 'sunday', schedule: { kind: 'weekly', isoWeekdays: [7], minuteOfDay: 660 } }),
        row({ id: 'monday', schedule: { kind: 'weekly', isoWeekdays: [1], minuteOfDay: 480 } }),
      ];
      const weekEnds = plan(m, { reminders: ends, horizonDays: 6 }).notifications.map((n) => `${n.reminderId}@${new Date(n.fireAtMs).toISOString().slice(0, 16)}`);
      deepStrictEqual(weekEnds, ['sunday@2026-10-18T11:00', 'monday@2026-10-19T08:00'], 'ISO weekday 7 is Sunday and 1 is Monday (never a 0-based Sunday)');
    },
  },
  {
    rule: 'plan-reject',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Validate each row (reminderProblem) and the channel against PlanInput.channelIds; return the refused rows in `rejected` with their problem and keep planning the others.',
    run: (m, { deepStrictEqual }) => {
      const reminders = [row({ id: 'bad-minute', schedule: { kind: 'daily', minuteOfDay: 1440 } }), row({ id: 'unknown-channel', channelId: 'marketing' }), row({ id: 'good' })];
      const result = plan(m, { reminders, horizonDays: 1 });
      deepStrictEqual(result.rejected.map((r) => r.reminderId), ['bad-minute', 'unknown-channel'], 'invalid rows and rows naming an undeclared channel are rejected');
      deepStrictEqual(result.notifications.map((n) => n.reminderId), ['good'], 'the valid row is still planned');
    },
  },
  {
    rule: 'plan-data',
    needs: ['plan'],
    fn: 'planReminders',
    fix: 'Attach only { kind: \'reminder\', reminderId } (reminderTapData): a tap reads the row again, so a path, title or URL in the data goes stale after an app update or a delete and is untrusted input.',
    run: (m, { deepStrictEqual, strictEqual }) => {
      const [first] = plan(m, { horizonDays: 1 }).notifications;
      deepStrictEqual({ ...first.data }, { kind: 'reminder', reminderId: 'task-42' }, 'the data names the reminder and nothing else');
      deepStrictEqual([first.title, first.body, first.channelId], ['Reminder', 'Water the plants', CHANNEL], 'the text comes from describe() and the channel from the row');
      strictEqual(first.reminderId, 'task-42', 'the planned notification names its reminder');
    },
  },
  {
    rule: 'reconcile-diff',
    needs: ['plan', 'reconcile'],
    after: ['plan-idempotent', 'plan-past'],
    fn: 'reconcileReminders',
    fix: 'Cancel pending identifiers that carry REMINDER_ID_PREFIX and are neither planned nor imminent (PlanResult.imminentIds, the third argument); schedule planned notifications that are not pending; never touch another feature\'s identifiers. The planner reports an occurrence due within the lead as imminent instead of dropping it, so a sync seconds before it fires keeps it.',
    run: (m, { deepStrictEqual }) => {
      const planned = plan(m, { horizonDays: 2 }).notifications;
      const plannedIds = planned.map((n) => n.id);
      const diff = (pending, next = planned, keep = []) => m.reconcile.reconcileReminders(next, pending, keep);
      deepStrictEqual(diff(plannedIds), { cancel: [], schedule: [] }, 'an unchanged plan is an empty diff');
      deepStrictEqual(diff([]).schedule.map((n) => n.id), plannedIds, 'everything is scheduled when nothing is pending');
      deepStrictEqual(diff(['timer:tea', 'push-1', ...plannedIds], []).cancel, plannedIds, 'only the planner\'s own identifiers are cancelled');
      // A sync two seconds before today's 09:00: that occurrence is pending and about to fire.
      const late = plan(m, { horizonDays: 2, nowMs: Date.UTC(2026, 9, 14, 8, 59, 58) });
      deepStrictEqual([...(late.imminentIds ?? [])], plannedIds.slice(0, 1), 'planReminders reports the occurrence due within the lead in imminentIds');
      deepStrictEqual(diff(plannedIds, late.notifications, late.imminentIds), { cancel: [], schedule: [] }, 'a pending notification due within the lead is kept, not cancelled');
      const gone = plan(m, { horizonDays: 2, nowMs: Date.UTC(2026, 9, 14, 8, 59, 58), reminders: [] });
      deepStrictEqual(diff(plannedIds, gone.notifications, gone.imminentIds ?? []).cancel, plannedIds, 'a deleted reminder\'s notification is cancelled even within the lead');
    },
  },
  {
    rule: 'tap-parse',
    needs: ['tap'],
    fn: 'parseReminderTap',
    fix: 'Treat notification data as untrusted: accept only { kind: \'reminder\', reminderId } with a short id of letters, digits, _ and -, and return null for anything else.',
    run: (m, { strictEqual }) => {
      const parse = m.tap.parseReminderTap;
      strictEqual(parse(m.tap.reminderTapData('task-42')), 'task-42', 'the data a reminder carries parses back to its id');
      for (const junk of [null, undefined, 'reminder', {}, { kind: 'task-assigned', taskId: '42' }, { kind: 'reminder', reminderId: 42 }, { kind: 'reminder', reminderId: '../settings' }, { kind: 'reminder', reminderId: 'x'.repeat(65) }]) {
        strictEqual(parse(junk), null, `${JSON.stringify(junk) ?? 'undefined'} is not a reminder tap`);
      }
    },
  },
];
