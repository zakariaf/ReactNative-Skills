// scripts/android/emulators.ts
// Dedicated emulators: AVDs named <prefix>-<purpose> (tasks-smoke, tasks-e2e), created once on the
// pinned system image, started on a console port this run picked, and addressed only by their serial
// (emulator-<port>) after the console confirmed the AVD name behind it. Only AVDs that carry the
// prefix are ever stopped or deleted: other sessions and agents share the machine and its adb server.
import { execFileSync } from 'node:child_process';

import { adbArgs } from './adb-args.ts';

/** The default hardware profile: a 1080 x 2400 phone every cmdline-tools release since 12 knows. */
export const DEFAULT_DEVICE_PROFILE = 'pixel_8';
/** adb finds emulators on console ports 5554..5584 (even; adb itself takes port + 1). */
export const FIRST_CONSOLE_PORT = 5554;
export const LAST_CONSOLE_PORT = 5584;

/** Runs `adb <args>` and returns stdout; throws on a non-zero exit (tests pass a fake). */
export type Adb = (args: readonly string[]) => string;
/** Which AVD a run wants. */
export type AvdSpec = {
  readonly name: string;
  readonly systemImage: string;
  readonly device: string;
};
/** One installed app the run launches. */
export type AndroidApp = { readonly apk: string; readonly packageName: string };

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHELL = 'shell';
const SERIAL_PORT = /^emulator-(\d+)\s/gm;
const DEMO = ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command'] as const;

/** The prefix from the package name: '@acme/tasks-app' -> 'tasks-app'. */
export function avdPrefixOf(packageName: string): string {
  const bare = packageName.split('/').at(-1) ?? '';
  const prefix = bare
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (prefix === '') throw new Error(`cannot derive an AVD prefix from "${packageName}"`);
  return prefix;
}

/** `tasks` + `smoke` -> `tasks-smoke`. Both parts are kebab-case. */
export function avdName(prefix: string, purpose: string): string {
  for (const part of [prefix, purpose]) {
    if (!KEBAB.test(part)) {
      throw new Error(`AVD name part "${part}" must be kebab-case, for example "smoke"`);
    }
  }
  return `${prefix}-${purpose}`;
}

/** Throws unless `name` is one of this repo's AVDs. */
export function assertOwnAvd(name: string, prefix: string): void {
  if (!name.startsWith(`${prefix}-`)) {
    throw new Error(`refusing to touch the AVD "${name}": not a ${prefix}-* emulator`);
  }
}

/** The console ports of every emulator `adb devices` lists (any session's). */
export function usedConsolePorts(adbDevices: string): Set<number> {
  return new Set([...adbDevices.matchAll(SERIAL_PORT)].map((match) => Number(match[1])));
}

/** The first free even console port adb scans; throws when all sixteen are taken. */
export function pickConsolePort(used: ReadonlySet<number>): number {
  for (let port = FIRST_CONSOLE_PORT; port <= LAST_CONSOLE_PORT; port += 2) {
    if (!used.has(port)) return port;
  }
  throw new Error('every emulator console port from 5554 to 5584 is taken on this machine');
}

/** The adb serial of the emulator on `port`. */
export function consoleSerial(port: number): string {
  return `emulator-${String(port)}`;
}

/** The AVD name from `adb -s <serial> emu avd name` ("tasks-smoke\r\nOK\r\n"), or null. */
export function avdNameFromConsole(output: string): string | null {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const name = lines.find((line) => line !== '' && line !== 'OK');
  return name ?? null;
}

/** avdmanager arguments that create `spec` (the run answers "no" to the custom profile question). */
export function createAvdArgs(spec: AvdSpec): string[] {
  return [
    'create',
    'avd',
    '--name',
    spec.name,
    '--package',
    spec.systemImage,
    '--device',
    spec.device,
  ];
}

/** emulator arguments: this AVD on this console port, headless, nothing saved on exit. */
export function emulatorArgs(name: string, port: number): string[] {
  return [
    '-avd',
    name,
    '-port',
    String(port),
    '-no-snapshot-save',
    '-no-boot-anim',
    '-no-audio',
    '-no-window',
  ];
}

/** `getprop sys.boot_completed` prints 1 once Android finished booting. */
export function isBootCompleted(getprop: string): boolean {
  return getprop.trim() === '1';
}

/** The launcher component from `cmd package resolve-activity --brief` (its last line). */
export function launcherComponentOf(output: string, packageName: string): string {
  const component = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.startsWith(`${packageName}/`));
  if (component === undefined) throw new Error(`${packageName} has no launcher activity installed`);
  return component;
}

/** The package of the resumed activity in `dumpsys activity activities`, or null. */
export function resumedPackageOf(dumpsys: string): string | null {
  const match =
    /(?:topResumedActivity|mResumedActivity|ResumedActivity)\s*[:=][^\n]*?\s([\w.]+)\/[\w.$]+/.exec(
      dumpsys,
    );
  return match?.[1] ?? null;
}

/** The crash buffer's report for `packageName` (`logcat -b crash -d`), or null. */
export function crashReportOf(crashLog: string, packageName: string): string | null {
  return crashLog.includes(`Process: ${packageName},`) ? crashLog.trim() : null;
}

/**
 * The System UI demo mode: 9:41, full battery not charging, full Wi-Fi without the no-internet mark
 * (`fully true`), no mobile signal, no notification icons. Verified on an API 35 image 2026-10-14.
 */
export function demoModeCommands(): string[][] {
  return [
    ['settings', 'put', 'global', 'sysui_demo_allowed', '1'],
    [...DEMO, 'enter'],
    [...DEMO, 'clock', '-e', 'hhmm', '0941'],
    [...DEMO, 'battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
    [...DEMO, 'network', '-e', 'wifi', 'show', '-e', 'level', '4', '-e', 'fully', 'true'],
    [...DEMO, 'network', '-e', 'mobile', 'hide'],
    [...DEMO, 'notifications', '-e', 'visible', 'false'],
  ];
}

/** adb bound to the binary and the tool environment; stderr is captured, a failure still throws. */
export function createAdb(adbPath: string, env: NodeJS.ProcessEnv): Adb {
  return (args) =>
    execFileSync(adbPath, args, {
      encoding: 'utf8',
      env,
      maxBuffer: 64 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/** The serial of `name` when it is running already (any port), else null. */
export function findRunningAvd(adb: Adb, name: string): string | null {
  const ports = [...usedConsolePorts(adb(['devices']))];
  const serials = ports.map(consoleSerial);
  return (
    serials.find(
      (serial) => avdNameFromConsole(adb(adbArgs(serial, 'emu', 'avd', 'name'))) === name,
    ) ?? null
  );
}

/** Throws unless the emulator behind `serial` is the AVD `name` (a port may have been reused). */
export function assertAvdBehind(adb: Adb, serial: string, name: string): void {
  const found = avdNameFromConsole(adb(adbArgs(serial, 'emu', 'avd', 'name')));
  if (found !== name)
    throw new Error(`${serial} runs "${String(found)}", not ${name}: refusing to use it`);
}

/** Unlocks the screen and pins the status bar (every boot resets demo mode). */
export function prepareForScreenshots(adb: Adb, serial: string): void {
  adb(adbArgs(serial, SHELL, 'wm', 'dismiss-keyguard'));
  for (const command of demoModeCommands()) adb(adbArgs(serial, SHELL, ...command));
}

/** A fresh install: the previous copy (and its data) goes first, so every run is a first launch. */
export function installFresh(adb: Adb, serial: string, app: AndroidApp): void {
  try {
    adb(adbArgs(serial, 'uninstall', app.packageName));
  } catch {
    // Not installed yet: nothing to remove.
  }
  adb(adbArgs(serial, 'install', app.apk));
}

/** Cold-starts the launcher activity (-S stops a running copy, -W waits for the launch). */
export function launchApp(adb: Adb, serial: string, packageName: string): void {
  const resolve = ['cmd', 'package', 'resolve-activity', '--brief', packageName];
  const component = launcherComponentOf(adb(adbArgs(serial, SHELL, ...resolve)), packageName);
  adb(adbArgs(serial, 'logcat', '-b', 'all', '-c'));
  adb(adbArgs(serial, SHELL, 'am', 'start', '-S', '-W', '-n', component));
}

/** Stops one of this repo's emulators by serial; refuses any other AVD. */
export function stopOwnEmulator(adb: Adb, serial: string, prefix: string): void {
  const name = avdNameFromConsole(adb(adbArgs(serial, 'emu', 'avd', 'name'))) ?? '';
  assertOwnAvd(name, prefix);
  adb(adbArgs(serial, 'emu', 'kill'));
}
