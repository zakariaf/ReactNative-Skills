// scripts/e2e/sample-sockets.ts
// The socket sampler the E2E runner starts once per device of the run and stops at the end.
// Usage: node scripts/e2e/sample-sockets.ts <ios|android> <offline-only|allowlist> <device-id> <app> <report> [<host>,...]
// <app> is the iOS executable (CFBundleExecutable) or the Android package. Once a second it lists the
// sockets of the app's copy on THIS device only (other sessions run the same app on theirs, and their
// traffic is not this run's) and appends every peer the policy does not allow to <report>, once.
// After every sample it rewrites its status (samples, samples that found the app, the last tool
// error) to <report>.sampler-<device-id>.json: the runner accepts an empty report as evidence only
// from a sampler that kept sampling until the end and found the app (sampler-evidence.ts).
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { androidSdk } from './android-device.ts';
import {
  appProcessPattern,
  canonicalHost,
  disallowedPeers,
  lsofPeers,
  pidsOf,
  procNetPeers,
  uidOfPackage,
  type Peer,
} from './network-sampler.ts';
import { NEW_SAMPLER_STATUS, nextSamplerStatus, samplerStatusPath } from './sampler-evidence.ts';
import { adbArgs } from '../android/adb-args.ts';

const SAMPLE_MS = 1000;
const RESOLVE_EVERY = 30;
const PROC_TABLES = ['tcp', 'tcp6', 'udp', 'udp6'];

/** One sample: was the app running on the device, its peers, and a tool failure if one happened. */
type Sample = {
  readonly isAppFound: boolean;
  readonly peers: Peer[];
  readonly error: string | null;
  /** The app was found but listing its sockets failed: this sample saw nothing. */
  readonly isListFailed: boolean;
};

const read = (tool: string, args: readonly string[]): string =>
  execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** pgrep and lsof exit 1 for "nothing found"; anything else is a real failure. */
const exitStatus = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;

const messageOf = (tool: string, error: unknown): string =>
  `${tool}: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`;

/** iOS: the simulator app is a macOS process; lsof lists its sockets (no sudo needed). */
function iosSample(udid: string, executable: string): Sample {
  let pids: string[];
  try {
    pids = pidsOf(read('pgrep', ['-f', appProcessPattern(executable, udid)]));
  } catch (error) {
    // pgrep exits 1 when the app is not running on this simulator (between flows, after a kill)
    const failure = exitStatus(error) === 1 ? null : messageOf('pgrep', error);
    return { isAppFound: false, peers: [], error: failure, isListFailed: false };
  }
  const failures: string[] = [];
  const peers = pids.flatMap((pid) => {
    try {
      return lsofPeers(read('lsof', ['-nP', '-i', '-a', '-p', pid]));
    } catch (error) {
      if (exitStatus(error) !== 1) failures.push(messageOf('lsof', error)); // 1: no sockets
      return [];
    }
  });
  const failure = failures.at(-1) ?? null;
  return { isAppFound: pids.length > 0, peers, error: failure, isListFailed: failure !== null };
}

/** Android: the rows of /proc/net that belong to the app's uid, while the app runs. */
function androidSample(serial: string, pkg: string): Sample {
  const adb = join(androidSdk(process.env), 'platform-tools', 'adb');
  try {
    const listed = read(adb, adbArgs(serial, 'shell', 'pm', 'list', 'packages', '-U', pkg));
    const uid = uidOfPackage(listed, pkg);
    if (uid === null) {
      const error = `pm list packages -U ${pkg}: no uid`;
      return { isAppFound: false, peers: [], error, isListFailed: false };
    }
    let pids: string[];
    try {
      pids = pidsOf(read(adb, adbArgs(serial, 'shell', 'pidof', pkg)).replace(/\s+/g, '\n'));
    } catch {
      pids = []; // pidof exits 1 when the app is not running
    }
    try {
      const peers = PROC_TABLES.flatMap((table) =>
        procNetPeers(read(adb, adbArgs(serial, 'shell', 'cat', `/proc/net/${table}`)), uid, table),
      );
      return { isAppFound: pids.length > 0, peers, error: null, isListFailed: false };
    } catch (error) {
      const isAppFound = pids.length > 0;
      return { isAppFound, peers: [], error: messageOf('adb', error), isListFailed: isAppFound };
    }
  } catch (error) {
    // the emulator is busy or restarting: the next sample tries again, the status keeps the error
    return { isAppFound: false, peers: [], error: messageOf('adb', error), isListFailed: false };
  }
}

/** The canonical addresses the allowed hosts resolve to right now. */
async function resolveAllowed(hosts: readonly string[]): Promise<Set<string>> {
  const addresses = new Set<string>();
  for (const host of hosts) {
    try {
      for (const { address } of await lookup(host, { all: true }))
        addresses.add(canonicalHost(address));
    } catch {
      // an allowed host that does not resolve allows nothing
    }
  }
  return addresses;
}

const USAGE =
  'usage: sample-sockets.ts <ios|android> <offline-only|allowlist> <device-id> <app> <report> [<host>,...]';

type Sampling = {
  readonly platform: 'ios' | 'android';
  readonly mode: 'offline-only' | 'allowlist';
  readonly deviceId: string;
  readonly app: string;
  readonly report: string;
  readonly allowHosts: readonly string[];
};

function readArgv(argv: readonly string[]): Sampling {
  const [platform, mode, deviceId, app, report, hosts = ''] = argv;
  if (platform !== 'ios' && platform !== 'android') throw new Error(USAGE);
  if (mode !== 'offline-only' && mode !== 'allowlist') throw new Error(USAGE);
  if (deviceId === undefined || app === undefined || report === undefined) throw new Error(USAGE);
  const allowHosts = hosts.split(',').filter((host) => host !== '');
  return { platform, mode, deviceId, app, report, allowHosts };
}

async function main(): Promise<void> {
  const sampling = readArgv(process.argv.slice(2));
  const { platform, mode, deviceId, app, report } = sampling;
  const statusFile = samplerStatusPath(report, deviceId);
  appendFileSync(report, ''); // network.txt exists once any sampler started
  const written = new Set<string>();
  let allowed = new Set<string>();
  let status = NEW_SAMPLER_STATUS;
  for (let sample = 0; ; sample += 1) {
    if (mode === 'allowlist' && sample % RESOLVE_EVERY === 0) {
      allowed = await resolveAllowed(sampling.allowHosts);
    }
    const found = platform === 'ios' ? iosSample(deviceId, app) : androidSample(deviceId, app);
    for (const { proto, peer } of disallowedPeers(found.peers, mode, allowed)) {
      const line = `${platform} ${deviceId} ${proto} ${peer}`;
      if (written.has(line)) continue;
      written.add(line);
      appendFileSync(report, `${line}\n`);
    }
    status = nextSamplerStatus(status, found);
    writeFileSync(statusFile, `${JSON.stringify(status)}\n`);
    await delay(SAMPLE_MS);
  }
}

await main();
