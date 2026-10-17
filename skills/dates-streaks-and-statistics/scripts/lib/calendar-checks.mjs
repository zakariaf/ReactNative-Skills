// calendar-checks.mjs: the pinned civil-date facts check-calendar-code runs against the app's
// src/core/dates/date-key.ts, and the countdown facts it runs against src/core/countdown/
// split-countdown.ts (a helper, not an entry point). The facts were computed with Python's
// datetime.date, an implementation independent of the module under test; the round trip covers
// 1900-01-01 .. 2400-12-31 and the oracle for each step is Date.UTC (a third implementation).

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The civil date `days` after 1970-01-01, computed with Date.UTC (tooling may read Date). */
function oracleKey(days) {
  return new Date(Date.UTC(1970, 0, 1 + days)).toISOString().slice(0, 10);
}

function isRealDay(text) {
  const match = KEY.exec(text);
  if (match === null) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Each fact: [label, run(mod) -> actual, expected]. */
const FACTS = [
  ["dayNumber('1970-01-01')", (mod) => mod.dayNumber('1970-01-01'), 0],
  ["dayNumber('2026-09-26')", (mod) => mod.dayNumber('2026-09-26'), 20_722],
  ["dayNumber('2000-03-01')", (mod) => mod.dayNumber('2000-03-01'), 11_017],
  ["dayNumber('1900-01-01')", (mod) => mod.dayNumber('1900-01-01'), -25_567],
  ["addDays('2026-02-28', 1)", (mod) => mod.addDays('2026-02-28', 1), '2026-03-01'],
  ["addDays('2028-02-28', 1) (leap year)", (mod) => mod.addDays('2028-02-28', 1), '2028-02-29'],
  ["addDays('2100-02-28', 1) (no leap day in 2100)", (mod) => mod.addDays('2100-02-28', 1), '2100-03-01'],
  ["addDays('2000-02-28', 1) (leap day in 2000)", (mod) => mod.addDays('2000-02-28', 1), '2000-02-29'],
  ["addDays('2026-03-29', 1) (a 23-hour day in Europe)", (mod) => mod.addDays('2026-03-29', 1), '2026-03-30'],
  ["daysBetween('2026-12-31', '2027-01-01')", (mod) => mod.daysBetween('2026-12-31', '2027-01-01'), 1],
  ["daysBetween('2026-09-27', '2026-09-26')", (mod) => mod.daysBetween('2026-09-27', '2026-09-26'), -1],
  ["isoWeekday('2026-09-26') (Saturday)", (mod) => mod.isoWeekday('2026-09-26'), 6],
  ["isoWeekday('2026-09-28') (Monday)", (mod) => mod.isoWeekday('2026-09-28'), 1],
  ["isoWeekday('1969-12-28') (Sunday, before day 0)", (mod) => mod.isoWeekday('1969-12-28'), 7],
  ["dayNumber('2026-9-26') (malformed)", (mod) => Number.isNaN(mod.dayNumber('2026-9-26')), true],
  ["dayNumber('2026-09-26T00:00:00Z') (an instant, not a day)", (mod) => Number.isNaN(mod.dayNumber('2026-09-26T00:00:00Z')), true],
];

const EXPORTS = ['dayNumber', 'fromDayNumber', 'addDays', 'daysBetween', 'isoWeekday'];

/** Returns [{ fn, message }] for every fact the module gets wrong (empty when it is exact). */
export function dateKeyFindings(mod) {
  const missing = EXPORTS.filter((name) => typeof mod[name] !== 'function');
  if (missing.length > 0) return missing.map((name) => ({ fn: name, message: `date-key.ts does not export the function ${name}` }));
  const out = [];
  for (const [label, run, expected] of FACTS) {
    let actual;
    try {
      actual = run(mod);
    } catch (error) {
      actual = `throws ${String(error?.message ?? error)}`;
    }
    if (actual !== expected) out.push({ fn: label.split('(')[0], message: `${label} is ${JSON.stringify(actual)}; the calendar says ${JSON.stringify(expected)}` });
  }
  for (let days = -25_567; days <= 157_419; days += 37) {
    const key = oracleKey(days);
    if (mod.fromDayNumber(days) !== key || mod.dayNumber(key) !== days) {
      out.push({ fn: 'fromDayNumber', message: `day ${days} should be ${key} both ways (fromDayNumber gives ${mod.fromDayNumber(days)}, dayNumber(${key}) gives ${mod.dayNumber(key)})` });
      break;
    }
  }
  if (typeof mod.isDateKey === 'function') {
    for (const text of ['2028-02-29', '2026-02-29', '2026-02-30', '2026-13-01', '2026-9-26']) {
      if (mod.isDateKey(text) !== isRealDay(text)) out.push({ fn: 'isDateKey', message: `isDateKey('${text}') is ${mod.isDateKey(text)}; it should be ${isRealDay(text)}` });
    }
  }
  return out;
}

/** Each countdown fact: [label, msLeft, expected { hours, minutes }]. */
const COUNTDOWN_FACTS = [
  ['3 h 5 min left', 11_100_000, { hours: 3, minutes: 5 }],
  ['the last 30 s of the day round up to 1 min', 30_000, { hours: 0, minutes: 1 }],
  ['a part minute rounds up', 3_600_001, { hours: 1, minutes: 1 }],
  ['the 25-hour day the clocks fall back', 90_000_000, { hours: 25, minutes: 0 }],
  ['midnight itself reads 0 h 0 min', 0, { hours: 0, minutes: 0 }],
];

/** Returns [{ fn, message }] for every countdown fact the module gets wrong (empty when it is exact). */
export function countdownFindings(mod) {
  if (typeof mod.splitCountdown !== 'function') return [{ fn: 'splitCountdown', message: 'split-countdown.ts does not export the function splitCountdown' }];
  const out = [];
  for (const [label, msLeft, expected] of COUNTDOWN_FACTS) {
    let actual;
    try {
      actual = mod.splitCountdown(msLeft);
    } catch (error) {
      actual = `throws ${String(error?.message ?? error)}`;
    }
    if (actual?.hours !== expected.hours || actual?.minutes !== expected.minutes) {
      out.push({ fn: 'splitCountdown', message: `splitCountdown(${msLeft}): ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})` });
    }
  }
  return out;
}
