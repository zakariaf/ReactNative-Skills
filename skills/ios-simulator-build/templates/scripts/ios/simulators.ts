// scripts/ios/simulators.ts
// Dedicated simulators named <prefix>-<purpose> (tasks-smoke, tasks-e2e): found or created once on
// the pinned runtime, then targeted only by UDID. Only simulators that carry the prefix are ever shut
// down or deleted, one at a time and never with "all": other sessions and agents share the Mac.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The default model: the 6.9-inch class that App Store screenshots also use. */
export const DEFAULT_DEVICE_TYPE = 'iPhone 17 Pro Max';

/** One device from `simctl list devices --json`. */
export type SimDevice = {
  readonly name: string;
  readonly udid: string;
  readonly state: string;
  readonly isAvailable?: boolean;
};
/** The JSON `simctl list devices --json` prints: devices per runtime identifier. */
export type SimctlDeviceList = { readonly devices: Readonly<Record<string, readonly SimDevice[]>> };
/** Runs `xcrun simctl <args>` and returns stdout (tests pass a fake). */
export type Simctl = (args: readonly string[]) => string;
/** Which simulator a run wants: its full name, its model and its runtime. */
export type SimulatorSpec = {
  readonly name: string;
  readonly deviceType: string;
  readonly runtime: string;
};
/** A built .app on disk and the bundle id read from its Info.plist. */
export type AppOnDisk = { readonly path: string; readonly bundleId: string };

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/** The prefix from the package name: '@acme/tasks-app' -> 'tasks-app'. */
export function simulatorPrefixOf(packageName: string): string {
  const bare = packageName.split('/').at(-1) ?? '';
  const prefix = bare
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (prefix === '') {
    throw new Error(`cannot derive a simulator prefix from the package name "${packageName}"`);
  }
  return prefix;
}

/** `tasks` + `smoke` -> `tasks-smoke`. Both parts are kebab-case. */
export function simulatorName(prefix: string, purpose: string): string {
  for (const part of [prefix, purpose]) {
    if (!KEBAB.test(part)) {
      throw new Error(`simulator name part "${part}" must be kebab-case, for example "smoke"`);
    }
  }
  return `${prefix}-${purpose}`;
}

/** Throws unless `udid` is a simulator UDID (never "booted", "all" or a device name). */
export function assertUdid(udid: string): void {
  if (!UDID.test(udid)) {
    throw new Error(`"${udid}" is not a simulator UDID: target one device by the UDID simctl gave`);
  }
}

/** The available device called `name` on `runtime` only (an older runtime's twin is ignored). */
export function findSimulator(
  list: SimctlDeviceList,
  name: string,
  runtime: string,
): SimDevice | undefined {
  return (list.devices[runtime] ?? []).find(
    (device) => device.name === name && device.isAvailable !== false,
  );
}

/** A clean, static status bar: 9:41, full battery without the charging bolt, full signal. */
export function statusBarArgs(udid: string): string[] {
  assertUdid(udid);
  return [
    ...['status_bar', udid, 'override', '--time', '9:41'],
    ...['--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3'],
    ...['--cellularMode', 'active', '--cellularBars', '4', '--operatorName', ''],
    ...['--batteryState', 'discharging', '--batteryLevel', '100'],
  ];
}

/**
 * simctl bound to the tool environment (DEVELOPER_DIR picks the pinned Xcode). stderr is captured,
 * not echoed: simctl io prints three lines per screenshot; a failing call still throws with it.
 */
export function createSimctl(env: NodeJS.ProcessEnv): Simctl {
  return (args) =>
    execFileSync('xcrun', ['simctl', ...args], {
      encoding: 'utf8',
      env,
      maxBuffer: 64 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/**
 * First boot of a new simulator: a 12-hour clock (a host with a 24-hour region otherwise draws 09:41)
 * and one throwaway screenshot, because the first launch can show a one-time system banner.
 */
function warmUp(simctl: Simctl, udid: string): void {
  simctl(['bootstatus', udid, '-b']);
  simctl(['spawn', udid, 'defaults', 'write', '-g', 'AppleLocale', '-string', 'en_US']);
  // simctl cannot write to /dev/null ("Operation not permitted"): use a throwaway file.
  const discard = join(tmpdir(), `first-boot-${udid}.png`);
  simctl(['io', udid, 'screenshot', discard]);
  rmSync(discard, { force: true });
  simctl(['shutdown', udid]);
}

/** The UDID of `spec.name` on `spec.runtime`, created and warmed up when it does not exist yet. */
export function ensureSimulator(simctl: Simctl, spec: SimulatorSpec): string {
  const list = JSON.parse(simctl(['list', 'devices', '--json'])) as SimctlDeviceList;
  const existing = findSimulator(list, spec.name, spec.runtime);
  if (existing !== undefined) {
    return existing.udid;
  }
  const udid = simctl(['create', spec.name, spec.deviceType, spec.runtime]).trim();
  assertUdid(udid);
  warmUp(simctl, udid);
  return udid;
}

/** Boots when needed, waits until ready and pins the status bar (every boot resets it). */
export function bootForScreenshots(simctl: Simctl, udid: string): void {
  simctl(['bootstatus', udid, '-b']);
  simctl(statusBarArgs(udid));
}

/** Installs the build and cold-starts it (a running copy is terminated first). */
export function installAndLaunch(simctl: Simctl, udid: string, app: AppOnDisk): void {
  simctl(['install', udid, app.path]);
  simctl(['launch', '--terminate-running-process', udid, app.bundleId]);
}

/** Shuts down one of this repo's simulators; refuses any other name. */
export function shutdownOwnSimulator(simctl: Simctl, device: SimDevice, prefix: string): void {
  if (!device.name.startsWith(`${prefix}-`)) {
    throw new Error(`refusing to shut down "${device.name}": not a ${prefix}-* simulator`);
  }
  simctl(['shutdown', device.udid]);
}

/** Deletes one of this repo's simulators; refuses any other name. */
export function deleteOwnSimulator(simctl: Simctl, device: SimDevice, prefix: string): void {
  if (!device.name.startsWith(`${prefix}-`)) {
    throw new Error(`refusing to delete "${device.name}": not a ${prefix}-* simulator`);
  }
  simctl(['delete', device.udid]);
}
