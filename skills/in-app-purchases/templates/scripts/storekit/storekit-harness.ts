// scripts/storekit/storekit-harness.ts: the StoreKit Tier 2 run on a throwaway iOS simulator of your own.
// Usage: node scripts/storekit/storekit-harness.ts --device <udid> [--variant development]
//          [--driver-port <n>] [--metro-port <n>]
// Prebuilds a harness project, builds it (Debug) against its own Metro port, starts Metro, then per
// scenario arms the simulator's StoreKit test store and runs one flow from .maestro/storekit/. Every
// Maestro call names the simulator and its own XCTest driver port (maestroGlobalArgs: a free port for
// each flow unless --driver-port is given), so no call reaches another session's simulator.
// Release-day order: the E2E evidence run, this harness, `xcrun simctl delete <udid>`, then
// `npx expo prebuild --platform ios --clean` before any Release or store build (they share ios/).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { busyNote } from './busy-note.ts';
import { driverPortFor, maestroGlobalArgs, maestroRunLine } from '../e2e/maestro-args.ts';

import type { MaestroTarget } from '../e2e/maestro-args.ts';

const HERE = import.meta.dirname;
const ROOT = process.cwd();
const FLOWS_DIR = join(ROOT, '.maestro', 'storekit');
const METRO_ATTEMPTS = 120;
const SECOND_MS = 1000;

/** [arm test or null, flow]. Order matters: the refund needs the purchase, the approval the pending one. */
const SCENARIOS: readonly (readonly [string | null, string])[] = [
  ['testArmDefault', '01-buy.yaml'],
  ['testRefundAll', '02-refund-relaunch.yaml'],
  ['testArmAskToBuy', '03-ask-to-buy.yaml'],
  ['testApproveAll', '04-approval-relaunch.yaml'],
  ['testArmDefault', '05-restore.yaml'],
  ['testArmFail', '06-failure.yaml'],
  [null, '07-store-unavailable.yaml'],
];

type Harness = {
  readonly env: NodeJS.ProcessEnv;
  readonly udid: string;
  /** This run's Metro port, built into the Debug app (RCT_METRO_PORT) and passed to expo start. */
  readonly metroPort: number;
  /** The Xcode scheme, the app target's name. */
  readonly scheme: string;
  readonly bundleId: string;
  /** The app's URL scheme, for the debug deep link. */
  readonly urlScheme: string;
};

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  execFileSync(command, args, { cwd: ROOT, env, stdio: 'inherit' });
}

function bundleIdOf(env: NodeJS.ProcessEnv): string {
  const json = execFileSync('npx', ['expo', 'config', '--json', '--type', 'public'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  const id = (JSON.parse(json) as { ios?: { bundleIdentifier?: string } }).ios?.bundleIdentifier;
  if (id === undefined) throw new Error('app.config.ts sets no ios.bundleIdentifier');
  return id;
}

function urlSchemeOf(ios: string, scheme: string): string {
  const key = 'CFBundleURLTypes.0.CFBundleURLSchemes.0';
  const plist = join(ios, scheme, 'Info.plist');
  return execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim();
}

/** A fresh CNG project plus the harness files and target. Never used for a shipped build. */
function prepareHarness(env: NodeJS.ProcessEnv, udid: string, metroPort: number): Harness {
  run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], env);
  const ios = join(ROOT, 'ios');
  const scheme = readdirSync(ios)
    .find((file) => file.endsWith('.xcworkspace'))
    ?.replace('.xcworkspace', '');
  if (scheme === undefined) throw new Error('no .xcworkspace after prebuild');
  const bundleId = bundleIdOf(env);
  copyFileSync(join(HERE, 'Premium.storekit'), join(ios, 'Premium.storekit'));
  mkdirSync(join(ios, 'StoreKitHarness'), { recursive: true });
  copyFileSync(join(HERE, 'ArmTests.swift'), join(ios, 'StoreKitHarness', 'ArmTests.swift'));
  copyFileSync(
    join(HERE, 'storekit-harness.entitlements'),
    join(ios, scheme, 'storekit-harness.entitlements'),
  );
  run('ruby', [join(HERE, 'add-harness.rb'), ios, scheme, bundleId], env);
  return { env, udid, metroPort, scheme, bundleId, urlScheme: urlSchemeOf(ios, scheme) };
}

function xcodebuild(h: Harness, action: readonly string[]): void {
  const common = ['-workspace', `${h.scheme}.xcworkspace`, '-scheme', h.scheme];
  const target = ['-configuration', 'Debug', '-destination', `id=${h.udid}`];
  const derived = ['-derivedDataPath', '../build/storekit'];
  // A Debug app loads its JS from Metro on RCT_METRO_PORT (8081 unless set): this run's own port.
  execFileSync('xcodebuild', [...action, ...common, ...target, ...derived], {
    cwd: join(ROOT, 'ios'),
    env: { ...h.env, RCT_METRO_PORT: String(h.metroPort) },
    stdio: 'inherit',
  });
}

/** testArmDefault | testArmAskToBuy | testArmFail | testApproveAll | testRefundAll */
function arm(h: Harness, test: string): void {
  xcodebuild(h, ['test-without-building', `-only-testing:StoreKitHarness/ArmTests/${test}`]);
}

/** Metro on this run's port (a Debug build loads its JS from it, over loopback only). */
async function startMetro(h: Harness): Promise<() => void> {
  const env = { ...h.env, CI: '1', EXPO_NO_TELEMETRY: '1' };
  const metro = spawn('npx', ['expo', 'start', '--port', String(h.metroPort)], { cwd: ROOT, env });
  for (let attempt = 0; attempt < METRO_ATTEMPTS; attempt += 1) {
    const status = await fetch(`http://localhost:${String(h.metroPort)}/status`).then(
      async (response) => response.text(),
      () => '',
    );
    if (status === 'packager-status:running') return () => metro.kill();
    await sleep(SECOND_MS);
  }
  metro.kill();
  throw new Error(`Metro did not start on port ${String(h.metroPort)}`);
}

/** Before the run and after a failed one: is the Mac too busy for StoreKit's test store? */
function busyNoteNow(): string | null {
  const [load = 0] = loadavg();
  return busyNote(load, availableParallelism());
}

/** e2e-maestro's pinned install (MAESTRO_BIN), else `maestro` on the PATH. */
function maestroBinary(env: Readonly<Record<string, string | undefined>>): string {
  return env['MAESTRO_BIN'] ?? 'maestro';
}

/** One Maestro run: the global --device and its own driver port (or the one --driver-port gives). */
async function runFlow(h: Harness, givenPort: string | undefined, flow: string): Promise<boolean> {
  const target: MaestroTarget = { udid: h.udid, driverPort: await driverPortFor(givenPort) };
  const maestro = maestroBinary(process.env);
  const vars = ['-e', `APP_ID=${h.bundleId}`, '-e', `APP_SCHEME=${h.urlScheme}`];
  const env = {
    ...process.env, // JAVA_HOME must point at Java 17 (Maestro 2.10)
    MAESTRO_CLI_NO_ANALYTICS: 'true',
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    MAESTRO_DISABLE_UPDATE_CHECK: 'true',
  };
  const command = ['test', join(FLOWS_DIR, flow), ...vars];
  console.error(maestroRunLine(target, command));
  const args = [...maestroGlobalArgs(target), ...command];
  return spawnSync(maestro, args, { stdio: 'inherit', env }).status === 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const valueOf = (flag: string): string | undefined =>
    argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
  const udid = valueOf('--device');
  if (udid === undefined) throw new Error('usage: storekit-harness.ts --device <udid>');
  const variant = valueOf('--variant') ?? 'development';
  const env = { ...process.env, APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant };
  // Refuse a non-UDID or a bad --driver-port before anything is built.
  const givenPort = valueOf('--driver-port');
  maestroGlobalArgs({ udid, driverPort: await driverPortFor(givenPort) });
  const metroPort = await driverPortFor(valueOf('--metro-port')); // any free port serves Metro too
  const busy = busyNoteNow();
  if (busy !== null) console.error(busy);
  const h = prepareHarness(env, udid, metroPort);
  xcodebuild(h, ['build-for-testing', '-sdk', 'iphonesimulator']);
  const stopMetro = await startMetro(h);
  let failures = 0;
  for (const [test, flow] of SCENARIOS) {
    if (test !== null) arm(h, test);
    if (!(await runFlow(h, givenPort, flow))) failures += 1;
  }
  stopMetro();
  console.error(`storekit: ${String(failures)} of ${String(SCENARIOS.length)} scenario(s) failed`);
  const busyAtEnd = failures > 0 ? busyNoteNow() : null;
  if (busyAtEnd !== null) console.error(busyAtEnd);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
