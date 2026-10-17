#!/usr/bin/env node
// check-reminder-code.mjs: scans an Expo app's source for the local-notification rules a reviewer
// would otherwise check by eye: expo-notifications only in adapters, scheduling only in the local
// notifications adapter and only through the one sync, one-shot date triggers on a channel, one
// foreground handler, no permission prompt at launch, localized text, no wall clock in reminder
// code, no USE_EXACT_ALARM, the sync mounted for the foreground and the taps read on a cold start.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-reminder-code.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createReporter, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { readManifest, hasSdk, reminderPaths, SDK } from './lib/reminder-paths.mjs';
import { importsOf, isTestFile, matchBracket, scanSource } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-reminder-code',
  summary: 'Scans the app for the local-notification rules: SDK only in adapters, scheduling only through the one sync, one-shot date triggers on a channel, one foreground handler, no prompt at launch, localized text, no wall clock in reminder code, no USE_EXACT_ALARM, the sync and tap hooks mounted.',
  usage: '[repo-root] [options]',
  options: {
    'core-dir': { type: 'string', value: 'dir', help: 'The pure reminder planner folder (default: <coreDir>/reminders; rn-skills.config.json "remindersCoreDir")' },
    'services-dir': { type: 'string', value: 'dir', help: 'The local notifications service folder (default: <servicesDir>/local-notifications; "localNotificationsDir")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: sdk-import, schedule-api, cancel-all, sync-only-writer, repeating-trigger, trigger-channel,',
    'foreground-handler, permission-at-launch, literal-text, wall-clock, exact-alarm, sync-on-foreground,',
    'tap-handling, root-kit (the local notifications root kit is registered in src/services/create-root-kits.ts).',
    `NOT APPLICABLE when ${SDK} is not in package.json, or when it is but nothing schedules a local`,
    'notification (no local notifications folder and no scheduling call: a push-only app).',
    'A root without a source folder (src/ by default) is bad input (exit 2).',
    'When multi-package: run once per app, with the app folder as the root.',
    'Example: node check-reminder-code.mjs .',
  ].join('\n'),
};

const CODE = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'];
const SCHEDULE_APIS = ['scheduleNotificationAsync', 'cancelScheduledNotificationAsync', 'getAllScheduledNotificationsAsync'];
const ADAPTER_NAME = /-adapter(\.(ios|android|native))?\.(ts|tsx)$/;
const REPEATING = [
  { re: /\bSchedulableTriggerInputTypes\.(DAILY|WEEKLY|MONTHLY|YEARLY|CALENDAR|TIME_INTERVAL)\b/g, what: (m) => `a ${m[1]} trigger` },
  { re: /\brepeats\s*:\s*true\b/g, what: () => 'repeats: true' },
  { re: /\btype\s*:\s*['"](daily|weekly|monthly|yearly|calendar|timeInterval)['"]/g, what: (m) => `a '${m[1]}' trigger` },
];
// A permission prompt in a startup file: the port's request, the SDK's, or a reminder sync's enable().
const LAUNCH_PROMPT = /\brequestPermission(?:sAsync)?\s*\(|\b\w*[sS]ync\s*(?:\?\.|\.)\s*enable\s*\(/g;
// The same prompt from an effect anywhere: the port's request or a reminder sync's enable(); the
// SDK's requestPermissionsAsync only in a file that imports expo-notifications (other SDKs share the name).
const EFFECT_PROMPT = /\.\s*requestPermission\s*\(|\b\w*[sS]ync\s*(?:\?\.|\.)\s*enable\s*\(/g;
const EFFECT_CALL = /(?<![\w$])(?:React\s*\.\s*)?(?:useEffect|useLayoutEffect|useInsertionEffect)\s*\(/g;
const DAY_MS = /\b(86_?400_?000|24\s*\*\s*60\s*\*\s*60\s*\*\s*1_?000|24\s*\*\s*3_?600_?000)\b/g;
const MARKER = 'not-a-calendar-day:';

const fixes = {
  'sdk-import': `Only an adapter (src/services/<concern>/<library>-<concern>-adapter.ts) imports ${SDK}; everything else takes the LocalNotificationsPort (or push-notifications' PushPort) from the composition root. Tests drive the adapter through jest.mock('${SDK}') and jest.requireMock, never an import.`,
  'schedule-api': 'Schedule, list and cancel local notifications only in the local notifications adapter (expo-local-notifications-adapter.ts), and only through the sync (createReminderSync). A second scheduler desyncs the cache the sync diffs against.',
  'cancel-all': 'Cancel by identifier (cancelNotifications(ids)): the sync cancels only identifiers it planned (REMINDER_ID_PREFIX); cancel-all also deletes other features\' notifications and the push service\'s. To reset after a restore, run the sync: the plan is the database.',
  'sync-only-writer': 'Call sync.request() (or await sync.sync()) after the reminder write commits; only reminder-sync.ts calls scheduleNotifications and cancelNotifications, so every change goes through one idempotent diff.',
  'repeating-trigger': 'Plan one-shot DATE triggers (planReminders): a repeating trigger cannot skip a done day, carries one fixed text, is iOS-only for CALENDAR, and its instant is invisible to the diff. The planner expands daily and weekly rules within the 64-notification window and the foreground sync refills it.',
  'trigger-channel': 'Give every date trigger the planned channel: trigger: { type: SchedulableTriggerInputTypes.DATE, date: n.fireAtMs, channelId: n.channelId }. Without it Android posts to the "Miscellaneous" fallback channel the person cannot recognise or mute on its own.',
  'foreground-handler': 'Call setNotificationHandler exactly once, in the adapter that owns it: expo-local-notifications-adapter.ts, or push-notifications\' adapter when push is adopted (then the composition root passes createExpoLocalNotificationsAdapter({ errorLog, installForegroundHandler: false })). On SDK 57 a reminder that fires while the app is open is not shown without it; a second call silently replaces the first.',
  'permission-at-launch': 'Ask from a person\'s action ("Remind me" calls sync.enable() in its press handler), after the app said why; never in a layout, the root navigator or the entry, and never from an effect (useEffect runs on mount, so the first screen\'s effect prompts at launch). A prompt at launch is refused more often, and iOS asks only once.',
  'literal-text': 'Build the title and body with t() at sync time (describeReminder(t)), and pass what the person wrote as a placeholder value (t(key, { labelText })): a literal, or a template literal with words around its ${}, is never translated, and the content hash in each identifier only re-plans text that comes from the catalogs.',
  'wall-clock': `Reminder code receives time as values: clock.nowMs(), clock.today() and zone.offsetAt from the ports; resolve a wall-clock minute with instantOfWallClock. A local day is 23, 24 or 25 hours; a deliberate fixed-24-hour constant carries "// ${MARKER} <why>" on the line above.`,
  'exact-alarm': 'Remove USE_EXACT_ALARM: Google Play allows it only for alarm-clock, timer and calendar apps. expo-notifications already falls back to inexact alarms; if minutes matter, declare SCHEDULE_EXACT_ALARM and handle its denial (references/platform-behaviour.md).',
  'sync-on-foreground': 'Mount useReminderSync(sync, t) (t from useT()) once inside the providers (the local notifications root kit\'s effects do): the pending window must be refilled on every return to the foreground, after a zone or clock change and after a language switch.',
  'root-kit': 'Register the kit in app-startup-and-bootstrap\'s registry src/services/create-root-kits.ts: createLocalNotificationsKit({ notifications, sync, hrefForReminder }) in the list createRootKits returns (examples/create-root-kits.ts); the root files stay unchanged.',
  'tap-handling': 'Read the launch tap as well as the listener: getLastNotificationResponse() in the adapter (lastTap), notifications.lastTap() next to every notifications.onTap(...) (useReminderTaps does both), and mount useReminderTaps(notifications, openReminder) once inside the navigator (the local notifications root kit\'s effects do). A tap that cold-starts the app reaches no listener.',
};

const isSdkSpec = (spec) => spec === SDK || spec.startsWith(`${SDK}/`);

/**
 * True for an import that TypeScript erases: `import type`, `export type`, a braced list whose every
 * name is `type X`, and a `typeof import` of the SDK in a type position. It never reaches native
 * code, so it may sit anywhere.
 */
function isTypeOnlyImport(code, entry) {
  if (entry.typeOnly) return true;
  const keywords = [...code.slice(0, entry.index).matchAll(/(?<![\w$.])(?:import|export)\b/g)];
  const keyword = keywords.at(-1);
  if (keyword === undefined) return false;
  if (entry.form === 'dynamic') return /\btypeof\s*$/.test(code.slice(0, keyword.index));
  if (entry.form !== 'import' && entry.form !== 'export') return false;
  const clause = code.slice(keyword.index + keyword[0].length, entry.index).replace(/\bfrom\s*$/, '');
  const braces = /\{([^}]*)\}/.exec(clause);
  const outside = clause.replace(/\{[^}]*\}/, '').replace(/[\s,]/g, '');
  const names = braces ? braces[1].split(',').map((name) => name.trim()).filter(Boolean) : [];
  return outside === '' && names.length > 0 && names.every((name) => /^type\s/.test(name));
}

/** The value imports of the SDK in a file (import, export from, side effect, dynamic, require). */
function sdkValueImports(scan) {
  return importsOf(scan).filter((entry) => isSdkSpec(entry.spec) && !isTypeOnlyImport(scan.code, entry));
}

function readCode(root, rel) {
  const text = readFileSync(join(root, rel), 'utf8');
  return { rel, text, code: maskComments(text) };
}

/** The scanned app files: everything under src/ plus a root entry file. */
function appFiles(root, layout) {
  return walkRepo(root, { include: CODE, ignore: ['**/*.d.ts'] })
    .filter((rel) => rel.startsWith(`${layout.srcDir}/`) || /^index\.[cm]?[jt]sx?$/.test(rel))
    .map((rel) => readCode(root, rel));
}

const isAdapter = (rel, layout) => rel.startsWith(`${layout.servicesDir}/`) && ADAPTER_NAME.test(rel) && !isTestFile(rel);
const inDir = (rel, dir) => rel.startsWith(`${dir}/`);

function callsOf(code, names) {
  const found = [];
  for (const name of names) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$])${name}\\s*\\(`, 'g'))) found.push({ name, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** True when a day-length constant at `index` carries the marker on its line or in the comment block right above. */
function hasMarker(text, index) {
  const lines = text.slice(0, index).split('\n');
  const lineEnd = text.indexOf('\n', index);
  if (text.slice(index, lineEnd === -1 ? text.length : lineEnd).includes(MARKER) || lines.at(-1).includes(MARKER)) return true;
  for (let at = lines.length - 2; at >= 0 && /^\s*(\/\/|\/?\*)/.test(lines[at]); at -= 1) {
    if (lines[at].includes(MARKER)) return true;
  }
  return false;
}

function checkFile(file, ctx, report) {
  const { rel, text, code } = file;
  const { layout, paths } = ctx;
  const problem = (index, rule, message) => report.problem({ file: rel, line: lineOf(text, index), rule, message, fix: fixes[rule] });
  const isTest = isTestFile(rel);
  const adapter = isAdapter(rel, layout);
  const localAdapter = adapter && inDir(rel, paths.notificationsDir);
  const scan = text.includes(SDK) || /use(?:Layout|Insertion)?Effect/.test(text) ? scanSource(text) : null;
  const sdkImports = scan === null ? [] : sdkValueImports(scan);
  if (!adapter) {
    for (const entry of sdkImports) problem(entry.index, 'sdk-import', `imports ${SDK} outside an adapter`);
  }
  if (isTest) return;
  for (const call of callsOf(code, ['cancelAllScheduledNotificationsAsync'])) {
    problem(call.index, 'cancel-all', 'cancels every scheduled notification at once');
  }
  if (!localAdapter) {
    for (const call of callsOf(code, SCHEDULE_APIS)) problem(call.index, 'schedule-api', `calls ${call.name} outside the local notifications adapter`);
  }
  const isPortFile = inDir(rel, paths.notificationsDir) && (/-port\.ts$/.test(rel) || /^fake-/.test(basename(rel)) || localAdapter);
  if (rel !== ctx.syncFile && !isPortFile) {
    for (const match of code.matchAll(/\.\s*(scheduleNotifications|cancelNotifications)\s*\(/g)) {
      problem(match.index, 'sync-only-writer', `calls ${match[1]} outside the reminder sync`);
    }
  }
  for (const { re, what } of REPEATING) {
    for (const match of code.matchAll(re)) problem(match.index, 'repeating-trigger', `schedules ${what(match)}`);
  }
  if (localAdapter) checkTriggers(file, problem);
  if (ctx.startupFile(rel)) {
    for (const match of code.matchAll(LAUNCH_PROMPT)) {
      problem(match.index, 'permission-at-launch', `asks for the notification permission while the app starts${promptName(match[0])}`);
    }
  } else if (scan !== null) {
    checkEffectPrompts(scan, sdkImports.length > 0 || adapter, problem);
  }
  if (inDir(rel, paths.notificationsDir) || inDir(rel, paths.coreDir)) checkReminderCode(file, problem);
}

const promptName = (call) => (/enable/.test(call) ? ` (${call.replace(/\s+/g, '').replace(/^\./, '').replace(/\($/, '()')})` : '');

/**
 * A permission prompt inside a useEffect / useLayoutEffect callback outside the startup files (a
 * screen's model, a provider): it runs on mount, so it prompts at launch when that screen is the
 * first one. The prompt belongs in a press handler.
 */
function checkEffectPrompts(scan, importsSdk, problem) {
  const { code } = scan;
  for (const effect of code.matchAll(EFFECT_CALL)) {
    const open = effect.index + effect[0].length - 1;
    const close = matchBracket(code, open);
    const body = code.slice(open, close === -1 ? code.length : close);
    const prompt = importsSdk ? new RegExp(`${EFFECT_PROMPT.source}|\\brequestPermissionsAsync\\s*\\(`, 'g') : new RegExp(EFFECT_PROMPT.source, 'g');
    for (const match of body.matchAll(prompt)) {
      problem(open + match.index, 'permission-at-launch', `asks for the notification permission from an effect, which runs on mount, not from a person's action${promptName(match[0])}`);
    }
  }
}

/** Every DATE trigger object in the local adapter names its channel. */
function checkTriggers({ code }, problem) {
  for (const match of code.matchAll(/\bSchedulableTriggerInputTypes\.DATE\b/g)) {
    const open = code.lastIndexOf('{', match.index);
    const close = open === -1 ? -1 : matchBracket(code, open);
    const body = close === -1 ? code.slice(match.index, match.index + 200) : code.slice(open, close);
    if (!/\bchannelId\b/.test(body)) problem(match.index, 'trigger-channel', 'a date trigger without a channelId');
  }
}

/**
 * The static text of a template literal opening at `index` (its ${...} spans removed), or null when
 * the lexer did not see a template there.
 */
function templateStatic(scan, index) {
  const entry = scan.stringAt.get(index);
  return entry === undefined || entry.quote !== '`' ? null : (entry.parts ?? []).join('');
}

/** Literal text and wall-clock reads in the planner and the service folder (adapters of the zone excepted). */
function checkReminderCode({ text, code }, problem) {
  let scan = null;
  for (const match of code.matchAll(/\b(title|body|subtitle)\s*:\s*(['"`])/g)) {
    if (match[2] === '`') {
      // Only interpolations (`${t('a')} ${t('b')}`) is allowed; any word around them is not.
      scan ??= scanSource(text);
      const quoteIndex = match.index + match[0].length - 1;
      const fixed = templateStatic(scan, quoteIndex);
      if (fixed !== null && !/\p{L}/u.test(fixed)) continue;
      problem(match.index, 'literal-text', `a template literal with fixed words as the notification ${match[1]}`);
      continue;
    }
    problem(match.index, 'literal-text', `a literal notification ${match[1]}`);
  }
  for (const match of code.matchAll(/\bDate\.now\s*\(|\bnew\s+Date\s*\(|\bperformance\.now\s*\(/g)) {
    problem(match.index, 'wall-clock', `reads the clock (${match[0].replace(/\s+/g, ' ').trim()})`);
  }
  for (const match of code.matchAll(DAY_MS)) {
    if (!hasMarker(text, match.index)) problem(match.index, 'wall-clock', `assumes a 24-hour day (${match[0]})`);
  }
}

/** USE_EXACT_ALARM anywhere in the app config except inside blockedPermissions. */
function checkAppConfig(root, report) {
  for (const rel of ['app.config.ts', 'app.config.js', 'app.json']) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const code = rel.endsWith('.json') ? text : maskComments(text);
    const blocked = [...code.matchAll(/blockedPermissions["']?\s*:\s*\[/g)].map((match) => {
      const open = match.index + match[0].length - 1;
      return [open, matchBracket(code, open)];
    });
    for (const match of code.matchAll(/USE_EXACT_ALARM/g)) {
      if (blocked.some(([open, close]) => match.index > open && match.index < close)) continue;
      report.problem({ file: rel, line: lineOf(text, match.index), rule: 'exact-alarm', message: 'declares android.permission.USE_EXACT_ALARM', fix: fixes['exact-alarm'] });
    }
  }
}

/** One handler, the sync hook mounted with a foreground trigger, the launch tap read and the tap hook mounted. */
function checkWiring(files, ctx, report) {
  const runtime = files.filter((file) => !isTestFile(file.rel));
  // The composition root hands the handler to push-notifications' adapter: the local adapter's call
  // site stays in the file but never runs, so it does not count.
  const handedOver = runtime.find((file) => !inDir(file.rel, ctx.paths.notificationsDir) && /\binstallForegroundHandler\s*:\s*false\b/.test(file.code));
  const counts = (file) => handedOver === undefined || !(isAdapter(file.rel, ctx.layout) && inDir(file.rel, ctx.paths.notificationsDir));
  const handlers = runtime.filter(counts).flatMap((file) => callsOf(file.code, ['setNotificationHandler']).map((call) => ({ ...call, file })));
  if (handlers.length === 0) {
    const message = handedOver === undefined
      ? 'no setNotificationHandler call: a reminder that fires while the app is open is not shown'
      : `${handedOver.rel} passes installForegroundHandler: false, but no other adapter calls setNotificationHandler: a reminder that fires while the app is open is not shown`;
    report.problem({ file: handedOver?.rel ?? ctx.adapterHint, line: handedOver === undefined ? 1 : lineOf(handedOver.text, handedOver.code.search(/\binstallForegroundHandler\s*:\s*false\b/)), rule: 'foreground-handler', message, fix: fixes['foreground-handler'] });
  }
  for (const extra of handlers.slice(1)) {
    report.problem({ file: extra.file.rel, line: lineOf(extra.file.text, extra.index), rule: 'foreground-handler', message: `a second setNotificationHandler call (the first is in ${handlers[0].file.rel}); the last one wins`, fix: fixes['foreground-handler'] });
  }
  const hookRel = `${ctx.paths.hooksDir}/use-reminder-sync.ts`;
  const hook = runtime.find((file) => file.rel === hookRel);
  if (hook !== undefined && !/\b(useIsAppActive|AppState)\b/.test(hook.code)) {
    report.problem({ file: hookRel, line: 1, rule: 'sync-on-foreground', message: 'the sync hook does not follow the app state', fix: fixes['sync-on-foreground'] });
  }
  const mounts = (name) => runtime.some((file) => !inDir(file.rel, ctx.paths.hooksDir) && callsOf(file.code, [name]).length > 0);
  if (!mounts('useReminderSync')) {
    report.problem({ file: hookRel, line: 1, rule: 'sync-on-foreground', message: 'nothing mounts useReminderSync, so the pending window is never refilled on return to the foreground', fix: fixes['sync-on-foreground'] });
  }
  const listens = runtime.filter((file) => callsOf(file.code, ['addNotificationResponseReceivedListener']).length > 0);
  for (const file of listens) {
    if (callsOf(file.code, ['getLastNotificationResponse', 'getLastNotificationResponseAsync', 'useLastNotificationResponse']).length === 0) {
      report.problem({ file: file.rel, line: lineOf(file.text, file.code.indexOf('addNotificationResponseReceivedListener')), rule: 'tap-handling', message: 'listens for taps but never reads the tap that launched the app', fix: fixes['tap-handling'] });
    }
  }
  for (const file of runtime) {
    const listener = file.code.search(/\.\s*onTap\s*\(/);
    if (listener !== -1 && !/\.\s*lastTap\s*\(/.test(file.code)) {
      report.problem({ file: file.rel, line: lineOf(file.text, listener), rule: 'tap-handling', message: 'subscribes to onTap but never reads lastTap(), so the tap that launched the app is lost', fix: fixes['tap-handling'] });
    }
  }
  if (!mounts('useReminderTaps')) {
    report.problem({ file: `${ctx.paths.hooksDir}/use-reminder-taps.ts`, line: 1, rule: 'tap-handling', message: 'nothing mounts useReminderTaps, so a tapped reminder opens only the app', fix: fixes['tap-handling'] });
  }
  // The root kit (app-startup-and-bootstrap's slots) mounts both hooks, but only once the registry creates it.
  const kitDefiners = new Set(runtime.filter((file) => /export\s+function\s+createLocalNotificationsKit\b/.test(file.code)).map((file) => file.rel));
  if (kitDefiners.size > 0 && !runtime.some((file) => !kitDefiners.has(file.rel) && callsOf(file.code, ['createLocalNotificationsKit']).length > 0)) {
    report.problem({ file: `${ctx.layout.servicesDir}/create-root-kits.ts`, line: 1, rule: 'root-kit', message: 'the local notifications root kit is never registered: nothing syncs on the way back to the foreground and no reminder tap opens its screen', fix: fixes['root-kit'] });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  requireDir(join(root, layout.srcDir), `app source folder ${layout.srcDir}/`);
  const report = createReporter({ name: 'check-reminder-code', json: options.json });
  if (!hasSdk(readManifest(root))) return report.notApplicable(`${SDK} is not in package.json`);
  const paths = reminderPaths(layout, options);
  const files = appFiles(root, layout);
  const schedules = files.some((file) => !isTestFile(file.rel) && callsOf(file.code, [...SCHEDULE_APIS, 'cancelAllScheduledNotificationsAsync']).length > 0);
  if (!schedules && !existsSync(join(root, paths.notificationsDir))) {
    return report.notApplicable(`${SDK} is installed but nothing schedules a local notification (no ${paths.notificationsDir}/ and no scheduling call)`);
  }
  const ctx = {
    layout,
    paths,
    syncFile: `${paths.notificationsDir}/reminder-sync.ts`,
    adapterHint: `${paths.notificationsDir}/expo-local-notifications-adapter.ts`,
    startupFile: (rel) => /(^|\/)_layout\.[jt]sx?$/.test(rel) || inDir(rel, `${layout.featuresDir}/root-navigator`) || /^index\.[cm]?[jt]sx?$/.test(rel),
  };
  for (const file of files) checkFile(file, ctx, report);
  checkAppConfig(root, report);
  checkWiring(files, ctx, report);
  return report.finish({ checked: files.length, unit: 'files' });
});
