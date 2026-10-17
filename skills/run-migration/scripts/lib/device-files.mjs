// device-files.mjs: the database folder of an app on a named iOS simulator or Android emulator, as
// a small file API the restore runs on (a helper, not an entry point). Devices are always named:
// simctl gets a UDID, adb gets -s <serial> before every command.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { fail, makeTempDir, removeTempDir } from '../check-lib.mjs';

/** adb arguments bound to one device: ['-s', serial, ...args]. */
export function adbArgs(serial, ...args) {
  if (typeof serial !== 'string' || serial === '') throw new Error('adbArgs needs a device serial');
  return ['-s', serial, ...args];
}

function runAdb(serial, args, { encoding = 'utf8', allowFail = false } = {}) {
  try {
    return execFileSync('adb', adbArgs(serial, ...args), { encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
  } catch (error) {
    if (allowFail) return null;
    fail(`adb ${adbArgs(serial, ...args).join(' ')} failed: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`, 'Check the serial (adb devices), that the emulator is booted, and that the build is debuggable (run-as needs it).');
  }
  return null;
}

/** The line of a simctl error that says what went wrong (not "An error was encountered ..."). */
function simctlReason(error) {
  const lines = String(error.stderr || error.message).split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !/^An error was encountered/i.test(line)) ?? lines[0] ?? `exit ${error.status}`;
}

/**
 * xcrun simctl <args>, trimmed stdout. `tolerate(status, stderr)` names the failures that are an
 * answer, not an error: runSimctl then returns null instead of stopping.
 */
function runSimctl(args, { tolerate = null } = {}) {
  try {
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (tolerate !== null && tolerate(error.status, String(error.stderr ?? ''))) return null;
    fail(`xcrun simctl ${args.join(' ')} failed: ${simctlReason(error)}`, 'Check Xcode (xcode-select -p), that the simulator is booted, the UDID (xcrun simctl list devices) and the bundle id; the app must be installed.');
  }
  return '';
}

/**
 * simctl terminate on an app that is not running exits 3 (ESRCH) with "found nothing to terminate"
 * (checked on Xcode 26.6, iOS 26.5): the app is already stopped, which is what the restore needs.
 */
const nothingToTerminate = (status, stderr) => status === 3 || /found nothing to terminate/i.test(stderr);

const SIDE_FILES = ['', '-wal', '-shm'];

/**
 * A folder on this computer (a copy, or a simulator's container): every step is a plain file
 * operation. `stop` is what stops the app first (nothing for a plain folder).
 */
export function localFolder(dir, { stop = null, stopText = 'make sure nothing has the database open (the app, a viewer, a test)' } = {}) {
  let tempDir = null;
  let copies = 0;
  return {
    where: dir,
    stopText,
    /** Stops the app; returns a line for the report, or nothing. */
    stop: () => stop?.(),
    /** Removes the temporary copies fetch made. */
    cleanup: () => {
      if (tempDir !== null) removeTempDir(tempDir);
    },
    list: () => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : []),
    /**
     * A local path holding a copy of the named file (with its -wal, so the copy reads what the app
     * wrote). Never the file itself: even a read-only SQLite connection to a WAL database creates
     * -wal and -shm beside it and cannot remove them, and the plan step must leave the folder as it was.
     */
    fetch: (name) => {
      tempDir ??= makeTempDir('restore-snapshot-');
      copies += 1;
      const copyDir = join(tempDir, `copy-${copies}`);
      mkdirSync(copyDir);
      for (const file of [name, `${name}-wal`]) if (existsSync(join(dir, file))) copyFileSync(join(dir, file), join(copyDir, file));
      return join(copyDir, name);
    },
    restore: (dbName, snapshotName, keepName) => {
      const keepDir = join(dir, keepName);
      mkdirSync(keepDir, { recursive: true });
      const moved = SIDE_FILES.map((suffix) => `${dbName}${suffix}`).filter((name) => existsSync(join(dir, name)));
      for (const name of moved) renameSync(join(dir, name), join(keepDir, name));
      copyFileSync(join(dir, snapshotName), join(dir, dbName));
      return moved;
    },
  };
}

/** iOS simulator: <data container>/Documents/SQLite (expo-sqlite's default directory). */
export function simulatorFolder(udid, bundleId) {
  const container = runSimctl(['get_app_container', udid, bundleId, 'data']);
  const dir = join(container, 'Documents', 'SQLite');
  if (!existsSync(dir)) fail(`no Documents/SQLite folder in ${bundleId}'s container on ${udid}`, 'Launch the app once so it opens its database.');
  return localFolder(dir, {
    stop: () =>
      runSimctl(['terminate', udid, bundleId], { tolerate: nothingToTerminate }) === null
        ? `${bundleId} was not running on ${udid} (nothing to terminate)`
        : `${bundleId} terminated on ${udid}`,
    stopText: `xcrun simctl terminate ${udid} ${bundleId}`,
  });
}

/**
 * Android emulator: files/SQLite inside the app's private folder, through run-as, which needs a
 * debuggable build: the development variant or a local debug build (npx expo run:android --variant
 * debug), never preview or production (release builds, not debuggable). Files are read out with
 * exec-out and changed in place with one run-as shell command, so the database never travels back
 * over adb.
 */
export function emulatorFolder(serial, packageName) {
  const sqliteDir = 'files/SQLite';
  const tempDir = makeTempDir('restore-snapshot-');
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  return {
    where: `${packageName}:${sqliteDir} on ${serial}`,
    stopText: `adb -s ${serial} shell am force-stop ${packageName}`,
    stop: () => {
      runAdb(serial, ['shell', 'am', 'force-stop', packageName]);
      return `${packageName} force-stopped on ${serial}`;
    },
    cleanup: () => removeTempDir(tempDir),
    list: () => {
      const out = runAdb(serial, ['shell', 'run-as', packageName, 'ls', '-1', sqliteDir]) ?? '';
      if (/run-as: /.test(out)) fail(`run-as refused: ${out.trim().split('\n')[0]}`, 'run-as needs a debuggable build: install the development variant or a local debug build (npx expo run:android --variant debug) of the same version; preview and production builds are release builds and refuse run-as. For a Release build, read the files as root (adb -s <serial> root) on a google_apis emulator image (persistence-and-migrations inspect-database --android-root) and restore a copy with --dir (references/restore-on-device.md).');
      return out.split('\n').map((line) => line.trim()).filter(Boolean);
    },
    fetch: (name) => {
      const bytes = runAdb(serial, ['exec-out', 'run-as', packageName, 'cat', `${sqliteDir}/${name}`], { encoding: 'buffer' });
      const path = join(tempDir, basename(name));
      writeFileSync(path, bytes);
      return path;
    },
    restore: (dbName, snapshotName, keepName) => {
      const moved = SIDE_FILES.map((suffix) => `${dbName}${suffix}`);
      const script = [
        `cd ${quote(sqliteDir)}`,
        `mkdir -p ${quote(keepName)}`,
        ...moved.map((name) => `if [ -e ${quote(name)} ]; then mv ${quote(name)} ${quote(keepName)}/; fi`),
        `cp ${quote(snapshotName)} ${quote(dbName)}`,
      ].join(' && ');
      runAdb(serial, ['shell', 'run-as', packageName, 'sh', '-c', quote(script)]);
      return moved;
    },
  };
}
