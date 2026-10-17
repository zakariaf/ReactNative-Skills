// stats-checks.mjs: the statistics, summary and completion rules check-streaks-and-stats runs
// against the app's own modules (a helper, not an entry point). Each check is
// { rule, fn, name, needs, fix, run(modules, assert) }. Inputs are plain objects in the stored shape.

import { deepFreeze } from './app-modules.mjs';
import { emptyLog, plusDays } from './streak-checks.mjs';

const TODAY = '2026-09-26';
const DONE = Object.freeze({ isSuccess: true, durationMs: 60_000, counters: Object.freeze({}) });
const LATE = Object.freeze({ ...DONE, isSuccess: false });

/** The empty stored statistics section (a fresh object each call). */
const emptyStats = () => ({ total: 0, successes: 0, failures: 0, durationMs: 0, currentRun: 0, longestRun: 0, bestDay: null, perDay: {}, counters: {} });

const fold = (mod, events, day = TODAY) => events.reduce((stats, event) => mod.recordActivity(stats, event, day), emptyStats());
const onDays = (mod, days, event = DONE) => days.reduce((stats, day) => mod.recordActivity(stats, event, day), emptyStats());

export const STATS_CHECKS = [
  {
    rule: 'stats-counts', fn: 'recordActivity', needs: ['activityStats'], name: 'totals, successes, failures and time add up',
    fix: 'total + 1, successes or failures + 1, durationMs + event.durationMs for every recorded event.',
    run: ({ activityStats }, { deepStrictEqual }) => {
      const stats = fold(activityStats, [DONE, LATE, DONE]);
      deepStrictEqual([stats.total, stats.successes, stats.failures, stats.durationMs], [3, 2, 1, 180_000]);
    },
  },
  {
    rule: 'stats-run', fn: 'recordActivity', needs: ['activityStats'], name: 'a failure resets the run of successes; the longest is kept',
    fix: 'currentRun = isSuccess ? currentRun + 1 : 0; longestRun = max(longestRun, currentRun).',
    run: ({ activityStats }, { strictEqual }) => {
      const stats = fold(activityStats, [DONE, DONE, DONE, LATE, DONE]);
      strictEqual(stats.currentRun, 1, 'the run restarts after a failure');
      strictEqual(stats.longestRun, 3, 'the longest run is kept');
    },
  },
  {
    rule: 'stats-best', fn: 'recordActivity', needs: ['activityStats'], name: 'the best day is kept after its bucket leaves the window',
    fix: 'Keep bestDay as a stored record: after adding to day D, if perDay[D].count > bestDay.count, bestDay = { date: D, count }.',
    run: ({ activityStats }, { deepStrictEqual }) => {
      const busy = onDays(activityStats, ['2026-08-01', '2026-08-01', '2026-08-01']);
      const later = activityStats.recordActivity(busy, DONE, TODAY);
      deepStrictEqual(later.bestDay, { date: '2026-08-01', count: 3 }, 'the best day survives pruning');
      const tie = onDays(activityStats, ['2026-09-20', '2026-09-21']);
      deepStrictEqual(tie.bestDay, { date: '2026-09-20', count: 1 }, 'a tie keeps the earlier day');
    },
  },
  {
    rule: 'stats-days', fn: 'recordActivity', needs: ['activityStats'], name: 'per-day buckets cover exactly the window, counted back from the newest day',
    fix: 'Add the event to perDay[day]; keep the dates with daysBetween(date, newest) < STATS_KEEP_DAYS; an older event still counts in the totals.',
    run: ({ activityStats }, { deepStrictEqual, strictEqual, ok }) => {
      const keep = activityStats.STATS_KEEP_DAYS;
      ok(Number.isInteger(keep) && keep > 0, 'exports STATS_KEEP_DAYS as a positive whole number of days');
      const stats = onDays(activityStats, [plusDays(TODAY, -keep), plusDays(TODAY, -(keep - 1)), TODAY, TODAY]);
      deepStrictEqual(Object.keys(stats.perDay).sort(), [plusDays(TODAY, -(keep - 1)), TODAY], `buckets of the last ${keep} days only`);
      deepStrictEqual(stats.perDay[TODAY], { count: 2, durationMs: 120_000 }, 'two events today');
      strictEqual(activityStats.recordActivity(stats, DONE, plusDays(TODAY, -keep)).total, 5, 'an event older than the window still counts in the totals');
    },
  },
  {
    rule: 'stats-counters', fn: 'recordActivity', needs: ['activityStats'], name: "counters fold by 'sum' or 'max' and are measured over the committed steps",
    fix: "'sum' adds the event's value to the stored one, 'max' keeps the larger; measureCounters measures every committed step ('sum' of the values, or their 'max', 0 without steps).",
    run: ({ activityStats }, { deepStrictEqual }) => {
      const event = (value) => ({ ...DONE, counters: { 'subtasks-completed': { value, aggregate: 'sum' }, 'longest-checklist': { value, aggregate: 'max' } } });
      deepStrictEqual(fold(activityStats, [event(4), event(7), event(2)]).counters, { 'subtasks-completed': 13, 'longest-checklist': 7 }, 'folded counters');
      const measure = (step) => step.length;
      deepStrictEqual(
        activityStats.measureCounters([{ id: 'subtasks-completed', aggregate: 'sum', measure }, { id: 'longest-checklist', aggregate: 'max', measure }], ['a', 'abc', '']),
        { 'subtasks-completed': { value: 4, aggregate: 'sum' }, 'longest-checklist': { value: 3, aggregate: 'max' } },
        'measured counters',
      );
      deepStrictEqual(activityStats.measureCounters([{ id: 'longest-checklist', aggregate: 'max', measure }], []), { 'longest-checklist': { value: 0, aggregate: 'max' } }, 'no steps measure 0');
    },
  },
  {
    rule: 'fold-immutable', fn: 'recordActivity', needs: ['activityStats'], name: 'recordActivity never changes its input',
    fix: 'Build new objects ({ ...stats.perDay, [day]: ... }, { ...stats.counters }); never assign into the section you were given.',
    run: ({ activityStats }, { deepStrictEqual }) => {
      const stats = fold(activityStats, [{ ...DONE, counters: { 'subtasks-completed': { value: 2, aggregate: 'sum' } } }]);
      const before = structuredClone(stats);
      deepFreeze(stats);
      activityStats.recordActivity(stats, { ...DONE, counters: { 'subtasks-completed': { value: 3, aggregate: 'sum' } } }, TODAY);
      deepStrictEqual(stats, before, 'the input section is unchanged');
    },
  },
  {
    rule: 'view-stats', fn: 'buildStatsSummary', needs: ['statsSummary'], name: 'the statistics summary: empty state, rate, duration, week bars, counters, stored counts',
    fix: 'isEmpty = total === 0; successRate = rateOf(successes, total) (0..1, 0 when empty); duration = splitDuration(durationMs) (whole minutes, truncated: 2 h 14 min 59 s is 2 h 14 min); seven bars oldest first with ISO weekdays and max >= 1; counters in the asked order (0 when absent); streak = the given counts (or null), unchanged.',
    run: ({ statsSummary }, { deepStrictEqual, strictEqual }) => {
      const empty = statsSummary.buildStatsSummary({ stats: emptyStats(), streak: null, today: TODAY, counterIds: [] });
      deepStrictEqual([empty.isEmpty, empty.overview.successRate, empty.week.max, empty.streak], [true, 0, 1, null], 'a new user: empty state, rate 0, bar scale 1, no streak block');
      const stats = { ...emptyStats(), total: 4, successes: 3, failures: 1, durationMs: 8_099_000, currentRun: 1, longestRun: 2, bestDay: { date: TODAY, count: 4 }, perDay: { [TODAY]: { count: 4, durationMs: 1 } }, counters: { 'subtasks-completed': 12 } };
      const streak = Object.freeze({ activeDays: 70, current: 5, best: 8 });
      const view = statsSummary.buildStatsSummary({ stats, streak, today: TODAY, counterIds: ['longest-checklist', 'subtasks-completed'] });
      strictEqual(view.isEmpty, false, 'not empty after an event');
      deepStrictEqual(view.overview, { total: 4, successes: 3, successRate: 0.75, duration: { hours: 2, minutes: 14 } }, 'overview');
      deepStrictEqual(view.streak, { activeDays: 70, current: 5, best: 8 }, 'the streak block shows the given counts unchanged');
      deepStrictEqual([view.week.bars.length, view.week.max], [7, 4], 'seven bars scaled by the busiest day');
      deepStrictEqual(view.week.bars.at(-1), { date: TODAY, weekday: 6, count: 4 }, 'the last bar is today, with its ISO weekday');
      deepStrictEqual(view.week.bars[0], { date: '2026-09-20', weekday: 7, count: 0 }, 'the first bar is six days ago');
      deepStrictEqual(view.counters, [{ id: 'longest-checklist', value: 0 }, { id: 'subtasks-completed', value: 12 }], 'counters in the asked order');
      deepStrictEqual([view.runs, view.bestDay], [{ current: 1, longest: 2 }, { date: TODAY, count: 4 }], 'runs and best day');
    },
  },
  {
    rule: 'completion-record', fn: 'recordCompletion', needs: ['recordCompletion'], name: 'one completion updates the streak and the statistics together, under its own day',
    fix: 'Practice returns progress itself; otherwise streak = recordDay(streak, completion.day, completion.dayResult) and stats = recordActivity(stats, completion.event, completion.day), in one returned object.',
    run: ({ recordCompletion }, { strictEqual, deepStrictEqual }) => {
      const start = { streak: emptyLog(), stats: emptyStats() };
      const completion = (day, firstTaskId) => ({ day, dayResult: { firstTaskId }, event: DONE, isPractice: false });
      strictEqual(recordCompletion.recordCompletion(start, { ...completion(TODAY, 1), isPractice: true }), start, 'practice records nothing');
      const first = recordCompletion.recordCompletion(start, completion('2026-09-25', 1));
      deepStrictEqual(Object.keys(first.streak.byDay), ['2026-09-25'], 'the streak records the day the activity started');
      deepStrictEqual([first.stats.total, first.stats.perDay['2026-09-25']?.count], [1, 1], 'the statistics record it in the same fold, under the same day');
      const second = recordCompletion.recordCompletion(first, completion('2026-09-25', 2));
      strictEqual(second.streak, first.streak, 'a repeat on an active day leaves the streak section untouched');
      deepStrictEqual([second.stats.total, second.stats.perDay['2026-09-25']?.count], [2, 2], 'a repeat on an active day still counts in the statistics');
    },
  },
  {
    rule: 'fold-immutable', fn: 'recordCompletion', needs: ['recordCompletion'], name: 'recordCompletion never changes its input',
    fix: 'Return a new { streak, stats } object built by the two pure folds; never assign into the progress you were given.',
    run: ({ recordCompletion }, { deepStrictEqual }) => {
      const progress = { streak: emptyLog(), stats: emptyStats() };
      const before = structuredClone(progress);
      deepFreeze(progress);
      recordCompletion.recordCompletion(progress, { day: TODAY, dayResult: { firstTaskId: 1 }, event: DONE, isPractice: false });
      deepStrictEqual(progress, before, 'the input progress is unchanged');
    },
  },
];
