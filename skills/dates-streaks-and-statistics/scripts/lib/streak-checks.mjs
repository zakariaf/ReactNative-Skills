// streak-checks.mjs: the streak rules check-streaks-and-stats runs against the app's own modules (a
// helper, not an entry point). Each check is { rule, fn, name, needs, when?, fix, run(modules, assert) }
// and throws when the module breaks the rule. Inputs are built as plain objects in the stored shape
// ({ byDay, activeDays, streak: { lastDate, length }, bestStreak }), so a check needs only the module
// it names.

import { deepFreeze } from './app-modules.mjs';

const FIRST = Object.freeze({ firstTaskId: 1 });
const SECOND = Object.freeze({ firstTaskId: 2 });

/** The empty stored section (a fresh object each call). */
export const emptyLog = () => ({ byDay: {}, activeDays: 0, streak: { lastDate: null, length: 0 }, bestStreak: 0 });

/** Civil-date arithmetic for building inputs (tooling may use Date.UTC). */
export function plusDays(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const record = (mod, dates, day = FIRST, start = emptyLog()) => dates.reduce((log, date) => mod.recordDay(log, date, day), start);

function keepDays(mod, name, assert) {
  const keep = mod[name];
  assert.ok(Number.isInteger(keep) && keep > 0, `exports ${name} as a positive whole number of days`);
  return keep;
}

function consecutive(from, count) {
  return Array.from({ length: count }, (_, index) => plusDays(from, index));
}

export const STREAK_CHECKS = [
  {
    rule: 'streak-first-of-day', fn: 'recordDay', needs: ['dayStreak'], name: 'the first event of a day counts; a repeat changes nothing',
    fix: 'if (Object.hasOwn(log.byDay, date)) return log; keep the first result of the day and count the day once.',
    run: ({ dayStreak }, { strictEqual, deepStrictEqual, ok }) => {
      const first = record(dayStreak, ['2026-09-26']);
      ok(dayStreak.isDayDone(first, '2026-09-26'), 'isDayDone after the first event');
      strictEqual(dayStreak.recordDay(first, '2026-09-26', SECOND), first, 'a repeat on the same day returns the same object');
      deepStrictEqual(first.byDay['2026-09-26'], FIRST, 'the first result of the day is kept');
      strictEqual(first.activeDays, 1, 'activeDays counts the day once');
    },
  },
  {
    rule: 'streak-rule', fn: 'recordDay', needs: ['dayStreak'], name: 'consecutive days grow the streak; a gap restarts it; the best streak is kept',
    fix: 'recordDay: gap 1 -> length + 1, gap > 1 -> 1, bestStreak = max(bestStreak, length).',
    run: ({ dayStreak }, { strictEqual }) => {
      const three = record(dayStreak, ['2026-09-24', '2026-09-25', '2026-09-26']);
      strictEqual(three.streak.length, 3, 'three consecutive days make a streak of 3');
      strictEqual(three.bestStreak, 3, 'the best streak follows a growing streak');
      const broken = record(dayStreak, ['2026-09-28'], FIRST, three);
      strictEqual(broken.streak.length, 1, 'a new streak after a gap');
      strictEqual(broken.bestStreak, 3, 'the best streak is kept after a gap');
    },
  },
  {
    rule: 'streak-rule', fn: 'currentStreak', needs: ['dayStreak'], name: 'the streak is "active yesterday or today"',
    fix: 'currentStreak is the stored length while the last active day is today or yesterday (or later), else 0.',
    run: ({ dayStreak }, { strictEqual }) => {
      const three = { byDay: {}, activeDays: 3, streak: { lastDate: '2026-09-26', length: 3 }, bestStreak: 3 };
      strictEqual(dayStreak.currentStreak(three, '2026-09-26'), 3, 'today');
      strictEqual(dayStreak.currentStreak(three, '2026-09-27'), 3, 'yesterday still counts');
      strictEqual(dayStreak.currentStreak(three, '2026-09-28'), 0, 'a missed day ends it');
      strictEqual(dayStreak.currentStreak(emptyLog(), '2026-09-26'), 0, 'a new user has no streak');
    },
  },
  {
    rule: 'streak-clock-back', fn: 'recordDay', needs: ['dayStreak'], name: 'a clock set back keeps done days and never double-counts',
    fix: 'Leave the streak unchanged when the new date is not after lastDate, keep the later days done, count an earlier day once, and ignore a date older than the kept window.',
    run: ({ dayStreak }, { strictEqual, deepStrictEqual, ok }) => {
      const later = record(dayStreak, ['2026-09-25', '2026-09-26']);
      const earlier = dayStreak.recordDay(later, '2026-09-20', FIRST);
      deepStrictEqual(earlier.streak, later.streak, 'the streak is unchanged by an earlier day');
      ok(dayStreak.isDayDone(earlier, '2026-09-26'), 'the later day stays done');
      strictEqual(earlier.activeDays, 3, 'the earlier day is counted once');
      strictEqual(dayStreak.recordDay(earlier, '2026-09-20', SECOND), earlier, 'the earlier day is never counted twice');
      const keep = keepDays(dayStreak, 'DAY_STREAK_KEEP_DAYS', { ok });
      const long = record(dayStreak, consecutive('2026-01-01', keep + 5));
      strictEqual(dayStreak.recordDay(long, '2026-01-02', SECOND), long, 'a day older than the kept window is ignored (it may have been counted and pruned)');
    },
  },
  {
    rule: 'streak-clock-back', fn: 'currentStreak', needs: ['dayStreak'], name: 'a clock set back before the last active day keeps showing the streak',
    fix: 'currentStreak: a today before lastDate (daysBetween(lastDate, today) < 0) still shows the stored length; only a gap of more than one day after lastDate ends it.',
    run: ({ dayStreak }, { strictEqual }) => {
      const two = { byDay: {}, activeDays: 2, streak: { lastDate: '2026-09-26', length: 2 }, bestStreak: 2 };
      strictEqual(dayStreak.currentStreak(two, '2026-09-24'), 2, 'two days before the last active day the streak still shows');
      strictEqual(dayStreak.currentStreak(two, '2026-09-10'), 2, 'a clock weeks behind still shows the streak');
    },
  },
  {
    rule: 'streak-prune', fn: 'recordDay', needs: ['dayStreak'], name: 'byDay is pruned to the window; the streak and activeDays keep counting',
    fix: 'Prune byDay to DAY_STREAK_KEEP_DAYS before the newest day on write; keep streak, bestStreak and activeDays as stored counters.',
    run: ({ dayStreak }, { strictEqual, ok }) => {
      const keep = keepDays(dayStreak, 'DAY_STREAK_KEEP_DAYS', { ok });
      const log = record(dayStreak, consecutive('2026-01-01', keep + 5));
      strictEqual(Object.keys(log.byDay).length, keep, `byDay keeps ${keep} days`);
      strictEqual(log.streak.length, keep + 5, 'the streak survives pruning');
      strictEqual(log.activeDays, keep + 5, 'activeDays survives pruning');
    },
  },
  {
    rule: 'streak-week', fn: 'recentDays', needs: ['dayStreak'], name: 'the recent days run oldest first and end with today',
    fix: 'Map index 0..count-1 to addDays(today, index - count + 1) with isDone = the day is in byDay.',
    run: ({ dayStreak }, { deepStrictEqual }) => {
      const log = record(dayStreak, ['2026-09-21', '2026-09-26']);
      deepStrictEqual(dayStreak.recentDays(log, '2026-09-26', 7).map((day) => `${day.date}:${day.isDone}`), [
        '2026-09-20:false', '2026-09-21:true', '2026-09-22:false', '2026-09-23:false', '2026-09-24:false', '2026-09-25:false', '2026-09-26:true',
      ]);
    },
  },
  {
    rule: 'streak-derive', fn: 'streakOfDays', needs: ['dayStreak'], when: ({ dayStreak }) => typeof dayStreak.streakOfDays === 'function',
    name: 'the streak derived from a kept history agrees with the stored one',
    fix: 'streakOfDays: de-duplicate and sort the days, then fold them with the same rule recordDay uses.',
    run: ({ dayStreak }, { deepStrictEqual }) => {
      const histories = [
        ['2026-09-26', '2026-09-24', '2026-09-25', '2026-09-25', '2026-09-20'],
        ['2026-12-31', '2027-01-01', '2027-01-02', '2026-12-29'],
        ['2028-02-28', '2028-03-01', '2028-02-29'],
        [],
      ];
      for (const days of histories) {
        const log = record(dayStreak, [...new Set(days)].sort());
        deepStrictEqual(dayStreak.streakOfDays(days), { activeDays: log.activeDays, streak: log.streak, bestStreak: log.bestStreak }, `streakOfDays([${days.join(', ')}])`);
      }
    },
  },
  {
    rule: 'fold-immutable', fn: 'recordDay', needs: ['dayStreak'], name: 'recordDay never changes its input',
    fix: 'Build new objects ({ ...log.byDay, [date]: day }); never assign into the section you were given.',
    run: ({ dayStreak }, { deepStrictEqual }) => {
      const log = record(dayStreak, ['2026-09-24', '2026-09-25']);
      const before = structuredClone(log);
      deepFreeze(log);
      dayStreak.recordDay(log, '2026-09-26', SECOND);
      dayStreak.recordDay(log, '2026-09-20', SECOND);
      deepStrictEqual(log, before, 'the input section is unchanged');
    },
  },
  {
    rule: 'view-streak', fn: 'buildStreakSummary', needs: ['streakSummary'], name: 'the streak summary: marks, ISO weekdays, today\'s result and stored counts',
    fix: 'mark = done for a recorded day, today for an unplayed today, missed otherwise; weekday = isoWeekday(date) (1 = Monday); todayResult = byDay[today] ?? null; counts from the stored counters.',
    run: ({ streakSummary }, { deepStrictEqual, strictEqual }) => {
      const fresh = streakSummary.buildStreakSummary(emptyLog(), '2026-09-26');
      deepStrictEqual(fresh.week.map((day) => day.weekday), [7, 1, 2, 3, 4, 5, 6], 'ISO weekdays for the letter and name keys');
      deepStrictEqual(fresh.week.map((day) => day.mark), ['missed', 'missed', 'missed', 'missed', 'missed', 'missed', 'today'], 'marks of a new user');
      strictEqual(fresh.todayResult, null, 'no result before today\'s first event');
      const played = { byDay: { '2026-09-25': SECOND, '2026-09-26': FIRST }, activeDays: 70, streak: { lastDate: '2026-09-26', length: 2 }, bestStreak: 9 };
      const view = streakSummary.buildStreakSummary(played, '2026-09-26');
      strictEqual(view.isDone, true, 'today is done');
      deepStrictEqual(view.todayResult, FIRST, 'today\'s first result');
      deepStrictEqual([view.currentStreak, view.bestStreak, view.activeDays], [2, 9, 70], 'streak, best streak and active days come from the stored section');
      deepStrictEqual(view.week.at(-1), { date: '2026-09-26', weekday: 6, mark: 'done', isToday: true }, 'the last cell is today');
    },
  },
  {
    rule: 'view-streak', fn: 'streakCountsOf', needs: ['streakSummary'], when: ({ streakSummary }) => typeof streakSummary.streakCountsOf === 'function',
    name: 'the streak counts a statistics screen shows come from the stored counters',
    fix: 'streakCountsOf(log, today) = { activeDays: log.activeDays, current: currentStreak(log, today), best: log.bestStreak }; never count the pruned byDay window.',
    run: ({ streakSummary }, { deepStrictEqual }) => {
      const played = { byDay: { '2026-09-25': FIRST }, activeDays: 70, streak: { lastDate: '2026-09-25', length: 5 }, bestStreak: 8 };
      deepStrictEqual(streakSummary.streakCountsOf(played, '2026-09-26'), { activeDays: 70, current: 5, best: 8 }, 'active days from the counter, the current streak alive from yesterday');
      deepStrictEqual(streakSummary.streakCountsOf(played, '2026-09-28'), { activeDays: 70, current: 0, best: 8 }, 'a missed day shows no current streak');
    },
  },
];
