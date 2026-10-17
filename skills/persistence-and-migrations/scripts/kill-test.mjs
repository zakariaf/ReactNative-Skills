#!/usr/bin/env node
// kill-test.mjs: the device kill test for the write path. It launches the installed app and kills it at
// growing delays while the startup open, migrations and first writes run, launches it once more and lets
// it settle (it must still be running: no crash loop after the kills), then copies the database out and
// inspects the copy: readable, the expected user_version, WAL, integrity, foreign keys (and with
// --document both slots and an empty quarantine). iOS: a dedicated simulator by UDID (or --create);
// Android: a dedicated emulator by serial. --dry-run prints the plan and never passes.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/kill-test.mjs --udid <id> --bundle-id <id> [options]
//      node ${CLAUDE_SKILL_DIR}/scripts/kill-test.mjs --serial <serial> --package <id> [options]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import { enableAppImports } from './lib/app-modules.mjs';
import { inspectDatabase, loadDatabaseSync, stageDatabase } from './lib/database-health.mjs';
import { adbArgs, emulatorDatabase, runAdb, runSimctl, simulatorDatabase } from './lib/device-copy.mjs';

const SPEC = {
  name: 'kill-test',
  summary: 'Runs the persistence kill test on a dedicated iOS simulator (UDID or --create) or Android emulator (serial): N launches killed at growing delays during the startup writes, then the database health check on a copy. Never targets a booted or default device.',
  usage: '(--udid <id> | --create) --bundle-id <id> | --serial <serial> --package <id>  [options]',
  options: {
    udid: { type: 'string', value: 'id', help: 'iOS: the dedicated simulator (this test kills apps on it)' },
    create: { type: 'boolean', help: 'iOS: create "<project>-kill-test" on the newest iOS runtime, delete it afterwards' },
    project: { type: 'string', value: 'name', help: 'Names the created simulator (default: package.json name of --repo or the working folder)' },
    'device-type': { type: 'string', value: 'name', help: 'iOS --create: device type (default: the newest iPhone the runtime supports)' },
    runtime: { type: 'string', value: 'id', help: 'iOS --create: runtime identifier (default: the newest available iOS runtime)' },
    app: { type: 'string', value: 'path', help: 'iOS: a built .app to install first (Release configuration)' },
    'bundle-id': { type: 'string', value: 'id', help: 'iOS: the app bundle id' },
    serial: { type: 'string', value: 'serial', help: 'Android: the dedicated emulator (adb devices), for example emulator-5554' },
    package: { type: 'string', value: 'id', help: 'Android: the app package name' },
    apk: { type: 'string', value: 'path', help: 'Android: an .apk to install first' },
    activity: { type: 'string', value: 'component', help: 'Android: the launch activity (<package>/<activity>; default: resolved with cmd package resolve-activity)' },
    'android-root': { type: 'boolean', help: 'Android: copy the database with root access (adb -s <serial> root; an image without Google Play) instead of run-as' },
    'db-name': { type: 'string', default: 'app.db', value: 'file', help: 'The database file name (contracts/persistence.json databaseFile)' },
    'expect-version': { type: 'string', value: 'n', help: 'The user_version the build writes (LATEST_DB_VERSION)' },
    document: { type: 'boolean', help: 'Also require both document slots and an empty document_quarantine' },
    'app-id': { type: 'string', value: 'id', help: 'With --document: the appId the document must carry' },
    repo: { type: 'string', value: 'dir', help: "App repo root: with --document, decode both slots with the app's own decodeSlot" },
    kills: { type: 'string', default: '12', value: 'n', help: 'Launch-and-kill rounds' },
    'step-ms': { type: 'string', default: '80', value: 'ms', help: 'Delay step: round i kills i x step ms after the launch returned (see below)' },
    'settle-ms': { type: 'string', default: '5000', value: 'ms', help: 'After the kills: one clean launch, left running this long (open and migrations finish) before the inspection' },
    'dry-run': { type: 'boolean', help: 'Print the plan without touching a device (exit 2, never PASS)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 0 },
  details: [
    'Pass criteria: every round launched and was killed; then one clean launch is left running --settle-ms',
    '(default 5000) and must still be running at the end (rule relaunch: the app comes back up after the',
    'kills, so --expect-version judges a finished open, not what the last kill left); then the copy is',
    'readable, at the expected user_version, in WAL mode, passes integrity_check and foreign_key_check,',
    'and (--document) both slots decode and document_quarantine is empty. Other rules come from',
    'inspect-database. Raise --settle-ms when the first upgrade on a slow device takes longer.',
    'iOS kills with SIGKILL (process.kill on the launch pid); Android with am force-stop, which SIGKILLs the',
    'process and also puts the package in the stopped state; for data integrity that equals a low-memory',
    'kill. A mid-session kill (do N things, kill, relaunch, assert) is an end-to-end flow on the same device.',
    '',
    'Timing: each delay counts from the moment the launch call returns. iOS: simctl launch returns once the',
    'process runs. Android: am start -W returns when the first frame is drawn (it prints TotalTime, the cold',
    'start), so delays start near the JS bundle load. Choose --step-ms so kills x step covers the time from',
    'that moment to the end of the startup writes: about 80 ms on a simulator, 120 to 200 ms on an emulator',
    'or an older phone (time one launch with a log line after openAppDatabase, or the outcome on screen).',
  ].join('\n'),
};

/** Synchronous sleep without a child process (an agent's own `sleep` may be blocked). */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function projectName(options) {
  if (options.project !== undefined) return options.project;
  const manifest = join(resolve(options.repo ?? '.'), 'package.json');
  const name = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : undefined;
  return String(name ?? basename(resolve(options.repo ?? '.'))).replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
}

/** The newest available iOS runtime and the newest iPhone it supports, unless given. */
function createTarget(options) {
  if (options.runtime !== undefined && options['device-type'] !== undefined) return { runtime: options.runtime, deviceType: options['device-type'] };
  const runtimes = JSON.parse(runSimctl(['list', 'runtimes', '-j'])).runtimes.filter((entry) => entry.isAvailable && /iOS/.test(entry.identifier ?? entry.name));
  const runtime = runtimes.find((entry) => entry.identifier === options.runtime) ?? runtimes.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1);
  if (runtime === undefined) fail('no available iOS simulator runtime', 'Install one in Xcode (Settings > Components), or pass --udid of a dedicated simulator.');
  // The highest-numbered iPhone, and its plain model among Pro and Plus: the list order is not by age.
  const generation = (type) => Number(/^iPhone (\d+)/.exec(type.name)?.[1] ?? 0);
  const phones = (runtime.supportedDeviceTypes ?? []).filter((type) => generation(type) > 0).sort((a, b) => generation(a) - generation(b) || b.name.length - a.name.length);
  const deviceType = options['device-type'] ?? phones.at(-1)?.identifier;
  if (deviceType === undefined) fail(`runtime ${runtime.identifier} supports no iPhone device type`, 'Pass --device-type.');
  return { runtime: runtime.identifier, deviceType };
}

function iosLane(options, dryRun) {
  const say = (args) => console.log(`would run: xcrun simctl ${args.join(' ')}`);
  const simctl = (args, extra = {}) => (dryRun ? (say(args), '') : runSimctl(args, extra));
  let udid = options.udid;
  if (options.create) {
    const name = `${projectName(options)}-kill-test`;
    if (dryRun) console.log(`would create ${name} on the newest iOS runtime with the newest iPhone it supports`);
    else {
      const { deviceType, runtime } = createTarget(options);
      udid = runSimctl(['create', name, deviceType, runtime]);
    }
    udid ??= '<new-udid>';
  }
  return {
    label: `simulator ${udid}`,
    prepare: () => {
      simctl(['boot', udid], { allowFail: true });
      simctl(['bootstatus', udid, '-b']);
      if (options.app !== undefined) simctl(['install', udid, options.app]);
    },
    round: (delay) => {
      simctl(['terminate', udid, options['bundle-id']], { allowFail: true });
      const launched = simctl(['launch', udid, options['bundle-id']]);
      if (dryRun) return console.log(`would kill -9 the app ${delay} ms after launch`);
      const pid = Number(/:\s*(\d+)\s*$/.exec(launched)?.[1]);
      if (!Number.isInteger(pid)) fail(`could not read the pid from "${launched}"`, 'Check that the bundle id is installed on this simulator.');
      sleepMs(delay);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // The app may have exited already; the database must still be healthy.
      }
      return console.log(`round: killed pid ${pid} after ${delay} ms`);
    },
    settle: (ms) => {
      simctl(['terminate', udid, options['bundle-id']], { allowFail: true });
      const launched = simctl(['launch', udid, options['bundle-id']]);
      if (dryRun) {
        console.log(`would leave the app running ${ms} ms and check its pid is still alive`);
        simctl(['terminate', udid, options['bundle-id']], { allowFail: true });
        return true;
      }
      const pid = Number(/:\s*(\d+)\s*$/.exec(launched)?.[1]);
      sleepMs(ms);
      let isRunning = Number.isInteger(pid);
      try {
        if (isRunning) process.kill(pid, 0);
      } catch {
        isRunning = false;
      }
      simctl(['terminate', udid, options['bundle-id']], { allowFail: true });
      console.log(`settle: pid ${pid} ${isRunning ? 'still running' : 'gone'} after ${ms} ms`);
      return isRunning;
    },
    copy: () => simulatorDatabase(udid, options['bundle-id'], options['db-name']),
    cleanup: () => {
      if (options.create && !dryRun) {
        runSimctl(['shutdown', udid], { allowFail: true });
        runSimctl(['delete', udid], { allowFail: true });
      }
    },
  };
}

const resolveActivityArgs = (pkg) => ['shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', pkg];

/** <package>/<activity> of the launcher activity, from --activity or the package manager. */
function launchComponent(options, adb) {
  if (options.activity !== undefined) return options.activity.includes('/') ? options.activity : `${options.package}/${options.activity}`;
  const output = adb(resolveActivityArgs(options.package));
  const component = String(output ?? '').trim().split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`${options.package}/`)).at(-1);
  if (component === undefined) fail(`no launcher activity found for ${options.package}: ${String(output ?? '').trim().split('\n').at(-1)}`, 'Install the build first (--apk), check --package, or pass --activity <package>/<activity>.');
  return component;
}

function androidLane(options, dryRun) {
  const { serial } = options;
  const adb = (args, extra = {}) => (dryRun ? console.log(`would run: adb ${adbArgs(serial, ...args).join(' ')}`) : runAdb(serial, args, extra));
  let component = options.activity ?? `${options.package}/<launcher activity>`;
  return {
    label: `emulator ${serial}`,
    prepare: () => {
      adb(['wait-for-device']);
      if (options.apk !== undefined) adb(['install', '-r', options.apk]);
      if (!dryRun) component = launchComponent(options, adb);
      else if (options.activity === undefined) adb(resolveActivityArgs(options.package));
    },
    round: (delay) => {
      adb(['shell', 'am', 'force-stop', options.package]);
      // -W waits for the first frame, so the delay starts after the cold start, near the JS open path.
      const launched = adb(['shell', 'am', 'start', '-W', '-n', component]);
      if (dryRun) return console.log(`would force-stop the app ${delay} ms after am start -W returns`);
      if (!/Status:\s*ok/.test(String(launched))) fail(`am start -W ${component} did not complete: ${String(launched).trim().split('\n').at(-1)}`, 'Check the build is installed and the activity is exported (--activity).');
      const total = /TotalTime:\s*(\d+)/.exec(String(launched))?.[1] ?? '?';
      sleepMs(delay);
      adb(['shell', 'am', 'force-stop', options.package]);
      return console.log(`round: force-stopped ${options.package} ${delay} ms after its first frame (cold start ${total} ms)`);
    },
    settle: (ms) => {
      adb(['shell', 'am', 'force-stop', options.package]);
      const launched = adb(['shell', 'am', 'start', '-W', '-n', component]);
      if (dryRun) {
        console.log(`would leave the app running ${ms} ms and check pidof still finds it`);
        adb(['shell', 'pidof', options.package]);
        adb(['shell', 'am', 'force-stop', options.package]);
        return true;
      }
      sleepMs(ms);
      const pid = String(runAdb(serial, ['shell', 'pidof', options.package], { allowFail: true }) ?? '').trim();
      const isRunning = /Status:\s*ok/.test(String(launched)) && /^\d+/.test(pid);
      adb(['shell', 'am', 'force-stop', options.package]);
      console.log(`settle: ${options.package} ${isRunning ? `still running (pid ${pid})` : 'gone'} after ${ms} ms`);
      return isRunning;
    },
    copy: () => emulatorDatabase(serial, options.package, options['db-name'], { root: options['android-root'] }),
    cleanup: () => undefined,
  };
}

function laneOf(options, dryRun) {
  const isIos = options.udid !== undefined || options.create;
  const isAndroid = options.serial !== undefined;
  if (isIos === isAndroid) fail('pass exactly one device: --udid <id> (or --create) for iOS, or --serial <serial> for Android', 'Name a dedicated simulator or emulator; the test kills apps on it.');
  if (isIos && options['bundle-id'] === undefined) fail('--bundle-id is required on iOS');
  if (isAndroid && options.package === undefined) fail('--package is required on Android');
  if (options.create && options.app === undefined) fail('--create makes an empty simulator: pass --app <path/to/App.app> too', 'Build the Release simulator app first (ios-simulator-build), then pass its .app path.');
  for (const file of [options.app, options.apk]) if (file !== undefined && !dryRun && !existsSync(file)) fail(`no build at ${file}`, 'Build the app first, then pass its path.');
  return isIos ? iosLane(options, dryRun) : androidLane(options, dryRun);
}

async function decoderOf(options) {
  if (options.repo === undefined || !options.document || options['app-id'] === undefined) return undefined;
  const repo = requireDir(options.repo, 'app repo root');
  const codec = await enableAppImports(repo).load(`${resolveLayout(repo).dataDir}/document/document-codec.ts`);
  return (record) => codec.decodeSlot(record, options['app-id']);
}

run(async () => {
  const { options } = parseArgs(process.argv.slice(2), SPEC);
  const dryRun = options['dry-run'];
  const kills = Number(options.kills);
  const stepMs = Number(options['step-ms']);
  const settleMs = Number(options['settle-ms']);
  if (![kills, stepMs, settleMs].every((value) => Number.isInteger(value) && value >= 1)) fail('--kills, --step-ms and --settle-ms must be positive whole numbers');
  const lane = laneOf(options, dryRun);
  const DatabaseSync = await loadDatabaseSync();
  if (DatabaseSync === null) fail('node:sqlite is not available in this Node', 'Use Node 22.18 or newer.');
  const decode = await decoderOf(options);
  const report = createReporter({ name: 'kill-test', json: options.json });
  try {
    lane.prepare();
    for (let round = 1; round <= kills; round += 1) lane.round(round * stepMs);
    // One clean launch after the kills: the app must come back up, and the inspection then judges a
    // finished open and migration, not whatever the last (longest) kill happened to leave behind.
    const isRunning = lane.settle(settleMs);
    if (dryRun) fail(`dry run: printed the plan for ${kills} rounds and a ${settleMs} ms settle launch on ${lane.label}, killed nothing`, 'Run again without --dry-run on the dedicated device with the build installed.');
    if (!isRunning) report.problem({ file: lane.label, rule: 'relaunch', message: `the app was not running ${settleMs} ms after the clean launch that followed the kills (a crash at startup?)`, fix: 'Read the device log for the crash (xcrun simctl spawn <udid> log show --last 2m, or adb -s <serial> logcat -d), fix the open path so it never throws, and run the kill test again.' });
    const source = lane.copy();
    const staged = stageDatabase(DatabaseSync, source, options['db-name']);
    try {
      const expectVersion = options['expect-version'] === undefined ? undefined : Number(options['expect-version']);
      const document = options.document ? { appId: options['app-id'], decode } : undefined;
      const result = inspectDatabase(DatabaseSync, staged.path, { expectVersion, document });
      for (const line of result.lines) console.log(line);
      for (const problem of result.problems) report.problem({ file: source, ...problem });
    } finally {
      staged.cleanup();
    }
  } finally {
    lane.cleanup();
  }
  return report.finish({ checked: kills, unit: 'kill rounds' });
});
