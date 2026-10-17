// device-copy.mjs: finds and copies an app's database out of a named simulator or emulator (a helper).
// Devices are always named: simctl gets a UDID, adb gets -s <serial>. The app's files are only read.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fail } from '../check-lib.mjs';

/** adb arguments bound to one device: ['-s', serial, ...args]. */
export function adbArgs(serial, ...args) {
  if (typeof serial !== 'string' || serial === '') throw new Error('adbArgs needs a device serial');
  return ['-s', serial, ...args];
}

export function runAdb(serial, args, { encoding = 'utf8', allowFail = false } = {}) {
  try {
    return execFileSync('adb', adbArgs(serial, ...args), { encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    if (allowFail) return null;
    fail(`adb ${adbArgs(serial, ...args).join(' ')} failed: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`, 'Check the serial (adb devices), that the emulator is booted, and the package name.');
  }
  return null;
}

export function runSimctl(args, { allowFail = false } = {}) {
  try {
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFail) return '';
    fail(`xcrun simctl ${args.join(' ')} failed: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`, 'Check Xcode (xcode-select -p), the UDID (xcrun simctl list devices) and the bundle id.');
  }
  return '';
}

/** iOS: <data container>/Documents/SQLite/<dbName> on the simulator with this UDID. */
export function simulatorDatabase(udid, bundleId, dbName) {
  const container = runSimctl(['get_app_container', udid, bundleId, 'data']);
  const path = join(container, 'Documents', 'SQLite', dbName);
  if (!existsSync(path)) fail(`no ${dbName} in ${join(container, 'Documents', 'SQLite')}`, 'Launch the app once so it opens its database, and check --db-name.');
  return path;
}

/**
 * Android: copies files/SQLite/<dbName> (+ -wal, -shm) out of the app's private folder into a temp
 * folder and returns the copy's path. run-as works for debuggable builds; with `root`, root access
 * (adb -s <serial> root) on an emulator image without Google Play reads /data/data/<package>/ for any build.
 */
export function emulatorDatabase(serial, packageName, dbName, { root = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'emulator-database-'));
  if (root) runAdb(serial, ['root']);
  for (const suffix of ['', '-wal', '-shm']) {
    const remote = root ? ['exec-out', 'cat', `/data/data/${packageName}/files/SQLite/${dbName}${suffix}`] : ['exec-out', 'run-as', packageName, 'cat', `files/SQLite/${dbName}${suffix}`];
    const bytes = runAdb(serial, remote, { encoding: 'buffer', allowFail: suffix !== '' });
    if (bytes === null || bytes.length === 0) {
      if (suffix === '') fail(`no ${dbName} read from ${packageName} on ${serial}`, root ? 'Launch the app once; adb -s <serial> root needs an emulator image without Google Play.' : 'run-as needs a debuggable build (development or preview); for a release build use an emulator image without Google Play and --android-root.');
      continue;
    }
    if (suffix === '' && /run-as: /.test(bytes.subarray(0, 200).toString('utf8'))) fail(`run-as refused: ${bytes.toString('utf8').trim().split('\n')[0]}`, 'Use a debuggable build, or --android-root on an emulator image without Google Play.');
    writeFileSync(join(dir, `${dbName}${suffix}`), bytes);
  }
  return join(dir, dbName);
}
