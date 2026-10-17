// scripts/build/emu-build-steps.ts
// The side effects of `npm run build:android:emu`, one small function each: run a logged step, keep
// package.json clean, create and start the dedicated emulator, wait for its boot, take screenshots
// and poll the app until it is ready. Proven by the emulator build itself (the skill's check-apk and
// check-emu-screenshot); the decisions they take live in the tested pure modules.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EMULATOR_LOG, LOG_DIR, onlyScriptsRewritten } from './emu-build-plan.ts';
import { EMU_READY_MAX_ATTEMPTS, EMU_READY_POLL_MS, emuReadyState } from './emu-ready-signal.ts';
import { adbArgs } from '../android/adb-args.ts';
import {
  assertAvdBehind,
  consoleSerial,
  crashReportOf,
  createAvdArgs,
  emulatorArgs,
  findRunningAvd,
  isBootCompleted,
  pickConsolePort,
  resumedPackageOf,
  usedConsolePorts,
  type Adb,
  type AvdSpec,
} from '../android/emulators.ts';

import type { ReadyLog } from './emu-build-config.ts';

/** Where a step runs and with which environment (one env object for the whole run). */
export type StepContext = { readonly appDir: string; readonly env: NodeJS.ProcessEnv };
/** One child process: the file, its arguments, where it runs and what it reads on stdin. */
export type Command = {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: 'root' | 'app' | 'android';
  readonly input?: string;
};
/** The SDK tools and environment the emulator steps use. */
export type EmuTools = {
  readonly adb: Adb;
  readonly adbPath: string;
  readonly emulatorPath: string;
  readonly avdmanagerPath: string;
  readonly env: NodeJS.ProcessEnv;
};
/** The running app a ready poll looks at. */
export type ReadyTarget = {
  readonly serial: string;
  readonly packageName: string;
  readonly readyLog: ReadyLog | null;
};

const SHELL = 'shell';
const BOOT_POLL_MS = 1000;
const BOOT_MAX_POLLS = 300;

function tail(file: string, lines: number): string {
  return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
}

function cwdOf(command: Command, appDir: string): string {
  if (command.cwd === 'root') return '.';
  return command.cwd === 'android' ? join(appDir, 'android') : appDir;
}

/** Runs one step with its output in build/android-emu/logs/<step>.log; throws with the log's tail. */
export function runStep(name: string, command: Command, context: StepContext): void {
  const logDir = join(context.appDir, LOG_DIR);
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${name}.log`);
  const fd = openSync(logFile, 'w');
  console.log(`build:android:emu: ${name} ...`);
  const result = spawnSync(command.file, command.args, {
    cwd: cwdOf(command, context.appDir),
    env: context.env,
    input: command.input,
    stdio: [command.input === undefined ? 'ignore' : 'pipe', fd, fd],
  });
  closeSync(fd);
  if (result.status !== 0) {
    const status = String(result.status);
    throw new Error(
      `step "${name}" failed (exit ${status}), see ${logFile}:\n${tail(logFile, 30)}`,
    );
  }
}

/** Writes package.json back when the prebuild only rewrote its ios and android scripts. */
export function keepPackageJson(path: string, before: string): void {
  const after = readFileSync(path, 'utf8');
  if (!onlyScriptsRewritten(before, after)) return;
  writeFileSync(path, before);
  console.log(
    `build:android:emu: restored ${path}: the prebuild had rewritten its ios/android scripts`,
  );
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Creates the AVD unless `emulator -list-avds` already lists it. */
export function ensureAvd(tools: EmuTools, spec: AvdSpec, context: StepContext): void {
  const listed = execFileSync(tools.emulatorPath, ['-list-avds'], {
    encoding: 'utf8',
    env: tools.env,
  });
  if (listed.split(/\r?\n/).some((line) => line.trim() === spec.name)) return;
  // avdmanager asks whether to create a custom hardware profile; the answer is no.
  runStep(
    'create-avd',
    { file: tools.avdmanagerPath, args: createAvdArgs(spec), input: 'no\n' },
    context,
  );
}

/** The emulator process this run started, and the log it writes. */
type StartedEmulator = {
  readonly serial: string;
  readonly pid: number | undefined;
  readonly logFile: string;
};

function startEmulator(tools: EmuTools, name: string, appDir: string): StartedEmulator {
  const port = pickConsolePort(usedConsolePorts(tools.adb(['devices'])));
  const logFile = join(appDir, EMULATOR_LOG);
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, 'w');
  const child = spawn(tools.emulatorPath, emulatorArgs(name, port), {
    detached: true,
    env: tools.env,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  closeSync(fd);
  return { serial: consoleSerial(port), pid: child.pid, logFile };
}

/**
 * Whether the started emulator has exited: `ps` lists no such process, or a zombie (`Z`), because
 * the blocking poll below keeps Node from reaping it. Read with ps, not child.exitCode, for that reason.
 */
function hasExited(pid: number | undefined): boolean {
  if (pid === undefined) return true;
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const stat = ps.stdout.trim();
  return stat === '' || stat.startsWith('Z');
}

function bootedYet(adb: Adb, serial: string): boolean {
  try {
    return isBootCompleted(adb(adbArgs(serial, SHELL, 'getprop', 'sys.boot_completed')));
  } catch {
    return false; // offline while it boots
  }
}

/**
 * Waits (polling, never a fixed sleep) until Android on `serial` reports boot completed. When this
 * run started the emulator, stops at once if that process exits (a console port another session's
 * emulator took, a missing system image, the AVD already running elsewhere) instead of polling a
 * dead serial for 5 minutes.
 */
export function waitForBoot(
  adb: Adb,
  serial: string,
  started: StartedEmulator | null = null,
): void {
  for (let poll = 1; poll <= BOOT_MAX_POLLS; poll += 1) {
    if (bootedYet(adb, serial)) return;
    if (started !== null && hasExited(started.pid)) {
      throw new Error(
        `the emulator for ${serial} exited before it booted; the end of ${EMULATOR_LOG}:\n${tail(started.logFile, 20)}`,
      );
    }
    sleep(BOOT_POLL_MS);
  }
  throw new Error(`${serial} did not finish booting in 5 minutes; see ${EMULATOR_LOG}`);
}

/** The serial of the AVD, started on a free port when it is not running; and whether this run started it. */
export function ensureEmulator(
  tools: EmuTools,
  name: string,
  appDir: string,
): { readonly serial: string; readonly isStartedHere: boolean } {
  const running = findRunningAvd(tools.adb, name);
  const started = running === null ? startEmulator(tools, name, appDir) : null;
  const serial = running ?? started?.serial ?? '';
  waitForBoot(tools.adb, serial, started);
  assertAvdBehind(tools.adb, serial, name);
  return { serial, isStartedHere: running === null };
}

/** One PNG of the emulator screen, through adb exec-out (no file on the device). */
export function screencap(tools: EmuTools, serial: string): Buffer {
  return execFileSync(tools.adbPath, adbArgs(serial, 'exec-out', 'screencap', '-p'), {
    env: tools.env,
    maxBuffer: 64 << 20,
  });
}

function isRunning(adb: Adb, target: ReadyTarget): boolean {
  try {
    return adb(adbArgs(target.serial, SHELL, 'pidof', target.packageName)).trim() !== '';
  } catch {
    return false; // pidof exits 1 when no process matches
  }
}

function probeApp(
  tools: EmuTools,
  target: ReadyTarget,
): { readonly alive: boolean; readonly resumed: boolean; readonly crash: string | null } {
  const { adb } = tools;
  const isAlive = isRunning(adb, target);
  const dumpsys = adb(adbArgs(target.serial, SHELL, 'dumpsys', 'activity', 'activities'));
  const crashLog = adb(adbArgs(target.serial, 'logcat', '-b', 'crash', '-d'));
  return {
    alive: isAlive,
    resumed: resumedPackageOf(dumpsys) === target.packageName,
    crash: crashReportOf(crashLog, target.packageName),
  };
}

function logMatched(adb: Adb, target: ReadyTarget): boolean | null {
  if (target.readyLog === null) return null;
  const lines = adb(adbArgs(target.serial, 'logcat', '-d', '-s', target.readyLog.tag));
  return lines.includes(target.readyLog.contains);
}

/** Polls every 500 ms, keeps the last screenshot and says why it stopped; throws on a crash. */
export function waitAndScreenshot(tools: EmuTools, target: ReadyTarget, out: string): string {
  mkdirSync(dirname(out), { recursive: true });
  let previous: Buffer = Buffer.alloc(0);
  for (let attempt = 1; attempt <= EMU_READY_MAX_ATTEMPTS; attempt += 1) {
    sleep(EMU_READY_POLL_MS);
    const current = screencap(tools, target.serial);
    writeFileSync(out, current);
    const app = probeApp(tools, target);
    const isScreenUnchanged = current.equals(previous);
    const state = emuReadyState({
      attempt,
      alive: app.alive,
      resumed: app.resumed,
      crashed: app.crash !== null,
      logMatched: logMatched(tools.adb, target),
      screenUnchanged: isScreenUnchanged,
    });
    if (state.kind === 'ready') return state.reason;
    if (state.kind === 'failed')
      throw new Error(`${state.reason}; look at ${out}\n${app.crash ?? ''}`);
    previous = current;
  }
  const seconds = String((EMU_READY_MAX_ATTEMPTS * EMU_READY_POLL_MS) / 1000);
  throw new Error(`the app was not ready after ${seconds} s; look at ${out}`);
}
