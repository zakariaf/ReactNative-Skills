#!/usr/bin/env node
// check-calendar-code.mjs: checks an Expo app's calendar-day code. It scans every runtime source
// file under src/ for the UTC day used as a local day, a date-only key parsed as UTC midnight, day counts made by dividing milliseconds,
// "today" cached in state or at module level, the wall clock read in day code, and day arithmetic in
// components and hooks; it checks that the clock port can tell the time to local midnight and that
// the day hooks re-render at midnight and on foreground; and it runs the app's date-key and
// countdown modules against pinned calendar facts.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-calendar-code.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, maskComments, matchGlob, notYetCreated, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { enableAppImports, lineOfExport } from './lib/app-modules.mjs';
import { countdownFindings, dateKeyFindings } from './lib/calendar-checks.mjs';
import { contractPathOf, readDayLogicContract } from './lib/day-logic-contract.mjs';
import { describeLoadError, loadFix } from './lib/load-error.mjs';
import { isTestFile } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-calendar-code',
  summary: 'Checks the calendar-day code of an Expo app: UTC days used as local days, date-only strings parsed as UTC, day counts from milliseconds, cached "today", wall-clock reads in day code, day arithmetic in components and hooks, the clock port\'s time to local midnight, the day hooks, and the date-key module\'s calendar facts.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'The app source folder (default: from resolveLayout, "src")' },
    contract: { type: 'string', value: 'file', help: 'The day-logic contract (default: contracts/day-logic.json; rn-skills.config.json "dayLogicContract")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  utc-day            toISOString().slice(0, 10), .split("T")[0], toJSON().slice(0, 10) or getUTC{FullYear,Month,Date,Day}()',
    '                     in app code: the UTC day, hours off from the user\'s local day',
    '  date-only-parse    new Date(\'YYYY-MM-DD\') or Date.parse(\'YYYY-MM-DD\'), or either with one argument named like a',
    '                     DateKey (dueOn, start_on, dayKey, lastDay, today, day): a date-only string parses as UTC',
    '                     midnight, the previous local day everywhere west of UTC',
    '  local-day-key      getFullYear() + getMonth() + getDate() in one file outside src/services/clock/ and src/i18n/:',
    '                     a day key built by hand from a Date, bypassing ClockPort.today()',
    '  day-ms-arithmetic  a duration divided by, or taken modulo, a whole number of days of milliseconds outside',
    '                     src/services/clock/: 86_400_000, 864e5, (1000 * 60 * 60 * 24) in any order, / 1000 / 60 / 60 / 24,',
    '                     DAY_MS and the like, or a constant the file (or an exported one) sets to such a product;',
    '                     a local day is 23, 24 or 25 hours long. Adding or subtracting a day of ms is not checked.',
    '  today-cached       today() kept in useState/useRef/useMemo (typed or not), copied into state by an effect, or read once at module level',
    '  wall-clock         Date, Date.now/parse, Math.random, Intl.DateTimeFormat/RelativeTimeFormat, toLocale*String or',
    '                     getTimezoneOffset in day code (src/core/**, the day hooks, *-summary.ts, contract modules and dayCode);',
    '                     new Date(<one value>).toISOString() (an epoch ms to ISO text, no clock, no zone) is allowed',
    '  day-maths-in-ui    addDays/daysBetween/dayNumber/fromDayNumber, .streak.length/.lastDate, .byDay/.perDay,',
    '                     msUntilNextLocalDay() or 86_400_000 in a component (.tsx) or hook (use-*.ts) other than the day hooks',
    '  today-hook         src/hooks/use-today.ts or use-next-day-countdown.ts lacks a timer or an AppState subscription',
    '  clock-countdown    the clock port, an adapter or the fake lacks msUntilNextLocalDay',
    '  date-math          src/core/dates/date-key.ts gets a pinned calendar fact or the 1900-2400 round trip wrong',
    '  view-countdown     src/core/countdown/split-countdown.ts does not round the time to midnight up to whole minutes,',
    '                     or src/hooks/use-next-day-countdown.ts exists without it',
    '  module-load        date-key.ts or split-countdown.ts cannot be imported as pure TypeScript',
    '',
    'A line (or the line above it) holding "// not-a-calendar-day: <why>" is exempt from utc-day, date-only-parse,',
    'local-day-key and day-ms-arithmetic: for a UTC date an API asks for, or a 24-hour duration that is not the user\'s day.',
    'Tests, __mocks__/ and test/ are not scanned; installed skills (any folder holding a SKILL.md, .agents/,',
    'skills/, ...) are left out. Expected SKIP lines when another skill has not created its file yet:',
    '  SKIP src/core/dates/date-key.ts [date-math] not yet created (seeded-determinism-and-golden-vectors creates it)',
    '  SKIP src/services/clock/clock-port.ts [clock-countdown] not yet created (architecture-and-boundaries creates it)',
    'When multi-package: run once per app, with the app folder as the root.',
    'Example: node check-calendar-code.mjs .',
  ].join('\n'),
};

const MARKER = 'not-a-calendar-day:';
const DAY = 86_400_000;
/** Constant names that always mean a day of milliseconds, even when defined in another package. */
const DAY_NAMES = ['DAY_MS', 'MS_PER_DAY', 'ONE_DAY_MS', 'DAY_IN_MS', 'MS_IN_A_DAY', 'MILLISECONDS_PER_DAY', 'MILLIS_PER_DAY'];
const NUM = String.raw`\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?`;
const PRODUCT = String.raw`${NUM}(?:\s*\*\s*${NUM})*`;
const TERM = String.raw`(?:\(\s*${PRODUCT}\s*\)|${PRODUCT})`;
/** `/ n`, `% n` or `/= n` where n is a numeric product in any order, then any chain of `/ n` divisors. */
const DIVIDE_BY_NUMBER = new RegExp(String.raw`[/%]=?\s*${TERM}(?:\s*\)*\s*\/(?![/*=])\s*${TERM})*`, 'g');
/** `const NAME = <numeric product>` (also exported, typed `: number`, or `as const`). */
const NUMERIC_CONST = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*(${TERM})\s*(?:as\s+const\s*)?(?=[;,\n)]|$)`, 'gm');

const FIX = {
  'utc-day': "Take the local day from ClockPort.today() (a DateKey); an epoch time becomes a day only in the clock adapter. Mark a UTC date an API wants with '// not-a-calendar-day: <why>'.",
  'date-only-parse': "A 'YYYY-MM-DD' string already is a DateKey: validate it with isDateKey() and keep it a string. When a picker or calendar library needs a Date, use localNoonOfDateKey(key) (new Date(y, m - 1, d, 12), local time) from src/services/clock/local-date.ts, and turn its Date back with dateKeyOfLocalDate(date).",
  'local-day-key': "Take the day from ClockPort.today() (the system adapter is the one place that turns a Date into a DateKey); format a date for display in src/i18n/. Mark a non-calendar use with '// not-a-calendar-day: <why>'.",
  'day-ms-arithmetic': "Count days with daysBetween() and move days with addDays() on DateKeys; for the time to midnight use ClockPort.msUntilNextLocalDay(). Mark a 24-hour duration that is not the user's day with '// not-a-calendar-day: <why>'.",
  'today-cached': 'Read today on every render with useToday() (it re-renders at local midnight and on foreground) and call clock.today() again inside handlers.',
  'wall-clock': 'Day code receives time as values: a DateKey from ClockPort.today() and epoch ms from nowMs(), passed in by the caller. Format dates in src/i18n/ (i18n-strings-and-catalogs).',
  'day-maths-in-ui': 'Components and hooks only format: take every number, mark and flag from buildStreakSummary / buildStatsSummary (or a pure module of the feature), and the time to midnight from useNextDayCountdown().',
  'today-hook': 'Copy the skill\'s templates/src/hooks/use-today.ts (or use-next-day-countdown.ts): a timer armed from msUntilNextLocalDay (capped at a minute) plus an AppState subscription.',
  'clock-countdown': 'Copy the clock folder from the skill templates: the port declares msUntilNextLocalDay: () => number, the system adapter computes it with the local calendar (DST-safe) and the fake counts it down.',
  'date-math': 'Restore src/core/dates/date-key.ts from the skill template (integer civil-date maths, no Date); seeded-determinism-and-golden-vectors owns it.',
  'view-countdown': 'Copy templates/src/core/countdown/split-countdown.ts (with its test): total minutes = ceil(ms / 60000), never 0 h 0 min before midnight; hours = floor(total / 60), minutes = total % 60. useNextDayCountdown() imports it.',
  'module-load': 'Keep the module pure: no React, React Native, Expo or app-layer imports.',
};

/**
 * `new Date(<one value>).toISOString()`: an epoch ms turned into ISO 8601 UTC text. It reads no clock
 * and no time zone, so it is not a wall-clock read (value-objects-money-and-units' instants do it).
 * `new Date()` with no argument, two or more arguments, or a local getter after it still counts.
 */
function isInstantToIso(code, match) {
  if (!/^new\s+Date$/.test(match[1])) return false;
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    const character = code[index];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        const argument = code.slice(open + 1, index);
        if (argument.trim() === '' || /,/.test(argument)) return false;
        return /^\s*\.toISOString\s*\(\s*\)/.test(code.slice(index + 1));
      }
    }
  }
  return false;
}

const PATTERNS = {
  utcDay: [
    /\.toISOString\(\s*\)\s*\.\s*(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)/g,
    /\.toISOString\(\s*\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/g,
    /\.toJSON\(\s*\)\s*\.\s*(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)/g,
    /\.getUTC(?:FullYear|Month|Date|Day)\s*\(/g,
  ],
  // `useState(clock.today())`, `useState(() => clock.today())` and the lazy initializer `useState(clock.today)`.
  todayInState: /\b(useState|useRef|useMemo)\s*(?:<[^>()]*>)?\s*\(\s*(?:\(\s*\)\s*=>\s*)?(?:[\w.?]*\btoday\s*\(\s*\)|[\w.?]*\.today\s*[,)])/g,
  todayInEffect: /\buseEffect\s*\(\s*\(\s*\)\s*=>\s*\{?[^}]*?\b(set[A-Z]\w*)\s*\(\s*[\w.?]*\btoday\s*\(\s*\)\s*\)/g,
  // new Date('2026-10-03') / Date.parse("2026-10-03"): ECMAScript parses a date-only string as UTC midnight.
  dateOnlyLiteral: /\b(new\s+Date|Date\.parse)\s*\(\s*(['"`])\d{4}-\d{2}-\d{2}\2\s*\)/g,
  // new Date(task.dueOn) / Date.parse(dayKey): one bare argument, judged by its last name segment.
  singleArgParse: /\b(new\s+Date|Date\.parse)\s*\(\s*((?:[A-Za-z_$][\w$]*\s*\??\.\s*)*([A-Za-z_$][\w$]*))\s*\)/g,
  localGetters: /\.(getFullYear|getMonth|getDate)\s*\(\s*\)/g,
  todayAtModule: /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*[\w.?()]*\btoday\s*\(\s*\)/gm,
  wallClock: /\b(Date\.now|new\s+Date|Date\.parse|Math\.random|Intl\.DateTimeFormat|Intl\.RelativeTimeFormat|toLocaleDateString|toLocaleTimeString|toLocaleString|getTimezoneOffset)\s*\(/g,
  uiDayCall: /\b(addDays|daysBetween|dayNumber|fromDayNumber)\s*\(/g,
  uiRawField: /\.streak\.(?:length|lastDate)\b|\.(?:byDay|perDay)\b/g,
  uiCountdown: /\bmsUntilNextLocalDay\s*\(\s*\)|\b86_?400_?000\b/g,
};

/** A name that holds a DateKey by convention: dueOn, start_on, dayKey, lastActiveDay, today, day (not startOfDay or dayMs). */
const KEY_LIKE_NAME = /^(?:today|day|dateKey)$|[a-z0-9](?:On|Key|Day)$|_(?:on|key|day)$/;
const NOT_KEY_NAME = /OfDay$/;

/** The value of a numeric product such as `(1000 * 60 * 60 * 24)` or `864e5`. */
function productValue(text) {
  return text.replace(/[()\s]/g, '').split('*').reduce((value, factor) => value * Number(factor.replace(/_/g, '')), 1);
}

/** The value of `/ a / b / c` (or `% a`): the product of every divisor. */
function divisorValue(text) {
  return text.replace(/^[/%]=?/, '').split('/').reduce((value, term) => value * productValue(term), 1);
}

const isWholeDays = (ms) => Number.isFinite(ms) && ms >= DAY && ms % DAY === 0;
const daysText = (ms) => (ms === DAY ? 'a day' : `${ms / DAY} days`);

/** { dayNames, otherNames }: names this source assigns to a whole number of days of ms, and to other numbers. */
function numericConstants(code) {
  const dayNames = new Map();
  const otherNames = new Set();
  for (const match of code.matchAll(NUMERIC_CONST)) {
    const ms = productValue(match[2]);
    if (isWholeDays(ms)) dayNames.set(match[1], ms);
    else otherNames.add(match[1]);
  }
  return { dayNames, otherNames };
}

/** The exported day constants of every scanned file, so `import { ONE_DAY } from ...` is caught too. */
function exportedDayNames(sources) {
  const names = new Map();
  for (const source of sources) {
    const code = maskComments(source);
    for (const [name, ms] of numericConstants(code).dayNames) {
      if (new RegExp(String.raw`\bexport\s+(?:const|let|var)\s+${name.replace(/\$/g, '\\$')}\b`).test(code)) names.set(name, ms);
    }
  }
  return names;
}

function hasMarker(lines, line) {
  return [line - 1, line - 2].some((index) => index >= 0 && (lines[index] ?? '').includes(MARKER));
}

/** The repo-relative globs of each scope, from the layout and the contract. */
function scopesOf(layout, contract) {
  const hooks = posix.join(layout.srcDir, 'hooks');
  const dayHooks = [posix.join(hooks, 'use-today.ts'), posix.join(hooks, 'use-next-day-countdown.ts')];
  const modules = contract === null ? [] : Object.values(contract.modules).filter((path) => path !== null);
  return {
    dayHooks,
    clockDir: posix.join(layout.servicesDir, 'clock'),
    i18nDir: posix.join(layout.srcDir, 'i18n'),
    dayCode: [`${layout.coreDir}/**`, ...dayHooks, `${layout.srcDir}/**/*-summary.ts`, ...modules, ...(contract?.dayCode ?? [])],
    uiCode: [`${layout.srcDir}/**/*.tsx`, `${layout.srcDir}/**/use-*.ts`, ...(contract?.uiCode ?? [])],
  };
}

function scanFile(rel, source, scopes, dayNames, add) {
  const code = maskComments(source);
  const lines = source.split('\n');
  const inScope = (globs) => globs.some((glob) => matchGlob(rel, glob));
  const each = (pattern, fn) => {
    for (const match of code.matchAll(pattern)) fn(match, lineOf(code, match.index));
  };
  for (const pattern of PATTERNS.utcDay) {
    each(pattern, (match, line) => {
      if (!hasMarker(lines, line)) add(rel, line, 'utc-day', `${match[0].trim()} is the UTC day, not the user's local day`);
    });
  }
  each(PATTERNS.dateOnlyLiteral, (match, line) => {
    if (!hasMarker(lines, line)) add(rel, line, 'date-only-parse', `${match[0].replace(/\s+/g, ' ')} parses a date-only string as UTC midnight, the previous day west of UTC`);
  });
  each(PATTERNS.singleArgParse, (match, line) => {
    const name = match[3];
    if (KEY_LIKE_NAME.test(name) && !NOT_KEY_NAME.test(name) && !hasMarker(lines, line)) {
      add(rel, line, 'date-only-parse', `${match[1].replace(/\s+/g, ' ')}(${match[2].replace(/\s+/g, '')}) parses a DateKey as UTC midnight, the previous day west of UTC`);
    }
  });
  if (!rel.startsWith(`${scopes.clockDir}/`)) {
    const dayMs = (match, line, ms) => {
      if (!hasMarker(lines, line)) add(rel, line, 'day-ms-arithmetic', `divides or takes the modulo of ${daysText(ms)} of milliseconds (${match[0].replace(/\s+/g, ' ').trim()})`);
    };
    each(DIVIDE_BY_NUMBER, (match, line) => {
      const ms = divisorValue(match[0]);
      if (isWholeDays(ms)) dayMs(match, line, ms);
    });
    const local = numericConstants(code);
    const names = new Map([...DAY_NAMES.map((name) => [name, DAY]), ...dayNames]);
    for (const name of local.otherNames) names.delete(name);
    for (const [name, ms] of local.dayNames) names.set(name, ms);
    if (names.size > 0) {
      const alternatives = [...names.keys()].map((name) => name.replace(/\$/g, '\\$')).join('|');
      each(new RegExp(String.raw`[/%]=?\s*\(?\s*(${alternatives})(?![\w$])`, 'g'), (match, line) => dayMs(match, line, names.get(match[1])));
    }
  }
  each(PATTERNS.todayInState, (match, line) => add(rel, line, 'today-cached', `keeps today in ${match[1]}`));
  each(PATTERNS.todayInEffect, (match, line) => add(rel, line + (match[0].slice(0, match[0].indexOf(match[1])).match(/\n/g)?.length ?? 0), 'today-cached', `copies today into state with ${match[1]}() in an effect, so it stays on the day the effect ran`));
  if (!rel.startsWith(`${scopes.clockDir}/`) && !rel.startsWith(`${scopes.i18nDir}/`)) {
    const getters = [...code.matchAll(PATTERNS.localGetters)];
    const names = new Set(getters.map((match) => match[1]));
    const first = getters.find((match) => match[1] === 'getFullYear');
    if (names.size === 3 && first) {
      const line = lineOf(code, first.index);
      if (!hasMarker(lines, line)) add(rel, line, 'local-day-key', 'builds a day key by hand from getFullYear(), getMonth() and getDate()');
    }
  }
  each(PATTERNS.todayAtModule, (_match, line) => add(rel, line, 'today-cached', 'reads today once, at module load'));
  if (inScope(scopes.dayCode)) {
    each(PATTERNS.wallClock, (match, line) => {
      if (isInstantToIso(code, match)) return;
      add(rel, line, 'wall-clock', `uses ${match[1].replace(/\s+/g, ' ')} in day code`);
    });
  }
  if (inScope(scopes.uiCode) && !scopes.dayHooks.includes(rel)) {
    each(PATTERNS.uiDayCall, (match, line) => add(rel, line, 'day-maths-in-ui', `computes ${match[1]}() in UI code`));
    each(PATTERNS.uiRawField, (match, line) => add(rel, line, 'day-maths-in-ui', `reads the stored ${match[0].slice(1)} in UI code`));
    each(PATTERNS.uiCountdown, (match, line) => add(rel, line, 'day-maths-in-ui', `computes the time to midnight in UI code (${match[0]})`));
  }
}

function checkDayHooks(root, scopes, report, add) {
  let checked = 0;
  for (const rel of scopes.dayHooks) {
    if (!existsSync(join(root, rel))) continue;
    checked += 1;
    const code = maskComments(readFileSync(join(root, rel), 'utf8'));
    if (!/\b(setTimeout|setInterval)\s*\(/.test(code)) add(rel, 1, 'today-hook', 'arms no timer, so it never re-renders at local midnight while the app stays open');
    if (!/\bAppState\b/.test(code)) add(rel, 1, 'today-hook', 'does not listen to AppState, so it keeps the old value after the app returns from the background');
  }
  return checked;
}

function checkClock(root, layout, scopes, report, add) {
  const port = posix.join(scopes.clockDir, 'clock-port.ts');
  const reason = notYetCreated(root, { file: port, owner: 'architecture-and-boundaries' });
  if (reason) {
    report.skip({ file: port, rule: 'clock-countdown', message: reason });
    return 0;
  }
  const files = walkRepo(root, { include: ['*.ts'] }).filter((rel) => posix.dirname(rel) === scopes.clockDir && !isTestFile(rel));
  let checked = 0;
  for (const rel of files) {
    const isPort = rel === port;
    if (!isPort && !/-adapter\.ts$|\/fake-clock\.ts$/.test(rel)) continue;
    checked += 1;
    const code = maskComments(readFileSync(join(root, rel), 'utf8'));
    const pattern = isPort ? /\bmsUntilNextLocalDay\s*:\s*\(\s*\)\s*=>\s*number\b/ : /\bmsUntilNextLocalDay\s*:/;
    if (!pattern.test(code)) add(rel, 1, 'clock-countdown', 'the clock cannot tell the time to local midnight (no msUntilNextLocalDay)');
  }
  return checked;
}

async function loadPure(root, layout, rel, report) {
  try {
    return await enableAppImports(root, { aliases: layout.aliases }).load(rel);
  } catch (error) {
    const reason = describeLoadError(error, root, layout);
    report.problem({ file: rel, line: 1, rule: 'module-load', message: `cannot be imported: ${reason}`, fix: loadFix(reason, FIX['module-load']) });
    return null;
  }
}

/** The countdown's pure module: required once the countdown hook exists, then run against pinned facts. */
async function checkCountdown(root, layout, scopes, report, add) {
  const rel = posix.join(layout.coreDir, 'countdown', 'split-countdown.ts');
  const hook = scopes.dayHooks[1];
  if (!existsSync(join(root, rel))) {
    if (existsSync(join(root, hook))) add(hook, 1, 'view-countdown', `useNextDayCountdown has no pure countdown module: ${rel} is missing`);
    return 0;
  }
  const mod = await loadPure(root, layout, rel, report);
  if (mod === null) return 1;
  const source = readFileSync(join(root, rel), 'utf8');
  for (const finding of countdownFindings(mod)) add(rel, lineOfExport(source, finding.fn), 'view-countdown', finding.message);
  return 1;
}

async function checkDateKey(root, layout, report, add) {
  const rel = posix.join(layout.coreDir, 'dates', 'date-key.ts');
  const reason = notYetCreated(root, { file: rel, owner: 'seeded-determinism-and-golden-vectors' });
  if (reason) {
    report.skip({ file: rel, rule: 'date-math', message: reason });
    return 0;
  }
  const mod = await loadPure(root, layout, rel, report);
  if (mod === null) return 1;
  const source = readFileSync(join(root, rel), 'utf8');
  for (const finding of dateKeyFindings(mod)) add(rel, lineOfExport(source, finding.fn), 'date-math', finding.message);
  return 1;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  requireDir(join(root, layout.srcDir), `app source folder ${layout.srcDir}/`);
  const contract = readDayLogicContract(root, contractPathOf(layout, options.contract));
  const scopes = scopesOf(layout, contract);
  const report = createReporter({ name: 'check-calendar-code', json: options.json });
  const add = (file, line, rule, message) => report.problem({ file, line, rule, message, fix: FIX[rule] });
  const files = walkRepo(root, { include: ['*.ts', '*.tsx'] }).filter((rel) => rel.startsWith(`${layout.srcDir}/`) && !rel.endsWith('.d.ts') && !isTestFile(rel));
  if (files.length === 0) fail(`nothing to check: no .ts or .tsx file under ${layout.srcDir}/`, 'Run from the app repo root, or pass --src-dir.');
  const sources = new Map(files.map((rel) => [rel, readFileSync(join(root, rel), 'utf8')]));
  const dayNames = exportedDayNames(sources.values());
  for (const [rel, source] of sources) scanFile(rel, source, scopes, dayNames, add);
  const extra = checkDayHooks(root, scopes, report, add) + checkClock(root, layout, scopes, report, add) + (await checkDateKey(root, layout, report, add)) + (await checkCountdown(root, layout, scopes, report, add));
  return report.finish({ checked: files.length + extra, unit: 'files and modules' });
});
