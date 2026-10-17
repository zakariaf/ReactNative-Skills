// Runs xcrun simctl, adb, the Android emulator tools and maestro. Every call goes through here so
// the self-test can swap in fake tools (a path ending in .mjs runs with this Node), and so every call
// names its device: simctl by UDID (never "booted" or "all"), adb with -s <serial> before the command
// (adbArgs), Maestro with --device <id> and this run's own --driver-host-port before the
// command (maestroArgs). Several sessions share one machine; a call that picks "the booted simulator"
// or "the only device" can reach someone else's.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { fail } from '../check-lib.mjs';

function exec(tool, args, { env, timeoutMs = 120000, input, encoding = 'utf8' } = {}) {
  const isScript = /\.m?js$/.test(tool);
  const result = spawnSync(isScript ? process.execPath : tool, isScript ? [tool, ...args] : args, {
    encoding,
    env: { ...process.env, ...env },
    timeout: timeoutMs,
    maxBuffer: 128 * 1024 * 1024,
    input,
  });
  if (result.error?.code === 'ENOENT') return { status: 127, stdout: encoding ? '' : Buffer.alloc(0), stderr: `${tool}: not found` };
  const stderr = typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? '');
  return { status: result.status ?? (result.error ? 1 : 0), stdout: result.stdout ?? (encoding ? '' : Buffer.alloc(0)), stderr: `${stderr}${result.error && result.error.code !== 'ENOENT' ? String(result.error.message) : ''}` };
}

export const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

// ---------------------------------------------------------------------------------------------
// iOS: xcrun simctl
// ---------------------------------------------------------------------------------------------

/** The simctl runner: simctl('list', 'devices', '-j'). Every device command passes a UDID. */
export function makeSimctl(xcrunPath) {
  const tool = xcrunPath || 'xcrun';
  const simctl = (...args) => exec(tool, ['simctl', ...args]);
  simctl.tool = tool;
  simctl.json = (...args) => {
    const r = simctl(...args);
    if (r.status !== 0) fail(`xcrun simctl ${args.join(' ')} failed (${r.status}): ${r.stderr.trim().split('\n')[0]}`, 'Install the Xcode the toolchain pins (ios-simulator-build) and point DEVELOPER_DIR at it; installing Xcode is a human step.');
    try {
      return JSON.parse(r.stdout);
    } catch {
      return fail(`xcrun simctl ${args.join(' ')} did not print JSON`, 'Check the Xcode installation.');
    }
  };
  return simctl;
}

/** Simulators with this exact name: [{ device, runtime }]. */
export function findSimulators(simctl, name) {
  const list = simctl.json('list', 'devices', '-j');
  const matches = [];
  for (const [runtime, devices] of Object.entries(list.devices ?? {})) {
    for (const d of devices) if (d.name === name) matches.push({ device: d, runtime });
  }
  return matches;
}

export function assertUdid(udid) {
  if (!UDID.test(String(udid ?? ''))) fail(`"${udid}" is not a simulator UDID`, "Pass the UDID of this session's own simulator (setup-parity-device.mjs prints it).");
  return udid;
}

// ---------------------------------------------------------------------------------------------
// Android: adb, emulator, avdmanager
// ---------------------------------------------------------------------------------------------

/** The Android SDK folder: $ANDROID_HOME, $ANDROID_SDK_ROOT, else the default macOS location. */
export function androidSdk() {
  for (const dir of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library', 'Android', 'sdk')]) if (dir && existsSync(dir)) return dir;
  return null;
}

/** The arguments that put a device in front of every adb command: ['-s', serial, ...command]. */
export function adbArgs(serial, ...command) {
  if (!/^[\w.:-]+$/.test(String(serial ?? ''))) fail(`"${serial}" is not an adb serial`, "Pass this session's own emulator serial (setup-parity-device.mjs prints it, for example emulator-5580).");
  return ['-s', serial, ...command];
}

/** The adb runner: adb(serial, 'shell', ...). Binary output with adb.raw. */
export function makeAdb(adbPath) {
  const sdk = androidSdk();
  const tool = adbPath || (sdk && existsSync(join(sdk, 'platform-tools', 'adb')) ? join(sdk, 'platform-tools', 'adb') : 'adb');
  const adb = (serial, ...command) => exec(tool, adbArgs(serial, ...command));
  adb.raw = (serial, ...command) => exec(tool, adbArgs(serial, ...command), { encoding: null });
  adb.devices = () => exec(tool, ['devices']);
  adb.tool = tool;
  return adb;
}

/** An adb runner bound to one serial: makeSerialAdb(adb, serial)('shell', 'wm', 'size'). */
export function makeSerialAdb(adb, serial) {
  adbArgs(serial);
  return (...command) => adb(serial, ...command);
}

/** avdmanager and emulator from the SDK (or the paths given). */
export function makeAndroidTools({ avdmanager, emulator } = {}) {
  const sdk = androidSdk();
  const pick = (given, rel, name) => given || (sdk && existsSync(join(sdk, ...rel)) ? join(sdk, ...rel) : name);
  const avdTool = pick(avdmanager, ['cmdline-tools', 'latest', 'bin', 'avdmanager'], 'avdmanager');
  const emulatorTool = pick(emulator, ['emulator', 'emulator'], 'emulator');
  return {
    avdmanager: (...args) => exec(avdTool, args, { timeoutMs: 300000 }),
    emulatorList: () => exec(emulatorTool, ['-list-avds']),
    /** Start the named AVD in the background on its own console port; never a running device. */
    startEmulator: (name, port) => {
      const isScript = /\.m?js$/.test(emulatorTool);
      const child = spawn(isScript ? process.execPath : emulatorTool, [...(isScript ? [emulatorTool] : []), '-avd', name, '-port', String(port), '-no-snapshot-save', '-no-boot-anim', '-no-audio'], { detached: true, stdio: 'ignore' });
      child.unref();
      return `emulator-${port}`;
    },
    tools: { avdmanager: avdTool, emulator: emulatorTool },
  };
}

// ---------------------------------------------------------------------------------------------
// Maestro
// ---------------------------------------------------------------------------------------------

/** Java 17 for Maestro: $JAVA_HOME, then Android Studio's bundled JBR, then /usr/libexec/java_home. */
export function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java'))) return process.env.JAVA_HOME;
  const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  if (existsSync(join(jbr, 'bin', 'java'))) return jbr;
  const r = exec('/usr/libexec/java_home', ['-v', '17']);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The driver port a session passed on purpose (--driver-port), else null (a free port is picked). */
export function driverPortOf(option) {
  if (option === undefined || option === null || option === '') return null;
  const port = Number(option);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail(`driver port "${option}" is not a port from 1024 to 65535`, 'Pass e.g. --driver-port 22187, or leave it out for a free port.');
  return port;
}

/** A port nobody listens on right now: the system picks it (listen on port 0), then it is released. */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port ? resolvePort(port) : reject(new Error('the system gave no free port'))));
    });
  });
}

/**
 * The global arguments that go before every Maestro command, as the app's E2E helper
 * (scripts/e2e/maestro-args.ts, maestroGlobalArgs) builds them: this device and this run's own driver
 * port on both platforms (the XCTest driver's host port on iOS, the adb forward's host port on
 * Android; Maestro 2.10 defaults both to 7001). Never a name, "booted", or the default port: a
 * hierarchy call once answered from another session's simulator.
 */
export function maestroGlobalArgs({ platform, id, driverPort }) {
  if (platform === 'ios') assertUdid(id);
  else adbArgs(id);
  if (!Number.isInteger(driverPort) || driverPort < 1024 || driverPort > 65535) fail(`driver port "${driverPort}" is not a port from 1024 to 65535`, 'Pass --driver-port, or let capture-app pick a free one.');
  return ['--device', id, '--driver-host-port', String(driverPort)];
}

/** One Maestro command with this run's global arguments in front: maestroArgs(target, 'hierarchy'). */
export function maestroArgs(target, ...command) {
  return [...maestroGlobalArgs(target), ...command];
}

/**
 * The maestro runner, or null when Maestro is not installed. Looked up in this order: --maestro,
 * maestro on PATH, ~/.maestro/bin/maestro. Every call site builds its arguments with maestroArgs().
 */
export function makeMaestro(maestroPath) {
  let tool = maestroPath || null;
  if (!tool) {
    const which = exec('/usr/bin/which', ['maestro']);
    if (which.status === 0 && which.stdout.trim()) tool = which.stdout.trim();
  }
  if (!tool && existsSync(join(homedir(), '.maestro', 'bin', 'maestro'))) tool = join(homedir(), '.maestro', 'bin', 'maestro');
  if (!tool) return null;
  const isFake = /\.m?js$/.test(tool);
  const javaHome = isFake ? null : findJavaHome();
  const env = { MAESTRO_CLI_NO_ANALYTICS: 'true', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true', MAESTRO_DISABLE_UPDATE_CHECK: 'true', ...(javaHome ? { JAVA_HOME: javaHome } : {}) };
  const maestro = (...args) => exec(tool, args, { env, timeoutMs: 180000 });
  maestro.tool = tool;
  maestro.javaHome = javaHome;
  return maestro;
}
