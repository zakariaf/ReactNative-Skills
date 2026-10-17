// scripts/e2e/maestro-run.ts
// The one spawn of the Maestro binary in the E2E tooling: runMaestro puts the device's id and a
// driver port of the run's own (maestro-args.ts) before the command, with Java 17 and no telemetry,
// update check or analysis prompt, so nothing leaves the machine and no run reaches another
// session's device. The pinned, checksum-verified install comes first (install-maestro.sh).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { freeDriverPort, maestroGlobalArgs, maestroRunLine } from './maestro-args.ts';

import type { BuiltApp } from './e2e-device.ts';

/** The installer (idempotent; a checksum mismatch deletes the download and exits 1). */
export const INSTALL_MAESTRO = join('scripts', 'e2e', 'install-maestro.sh');
/** The shared setup sub-flow: a tool opens the debug link through it, never with simctl openurl. */
export const DEBUG_SETUP_FLOW = join('.maestro', 'subflows', 'debug-setup.yaml');
/** Android Studio's bundled JDK 17, when /usr/libexec/java_home -v 17 finds none. */
const ANDROID_STUDIO_JAVA = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';

/** The three variables read from the Maestro 2.10.0 jar: no analytics, no analysis prompt, no update check. */
export const MAESTRO_QUIET_ENV = {
  MAESTRO_CLI_NO_ANALYTICS: 'true',
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
  MAESTRO_DISABLE_UPDATE_CHECK: 'true',
} as const;

/** MAESTRO_DRIVER_STARTUP_TIMEOUT (read in the 2.10.0 jar) unless the caller sets it. */
const DRIVER_STARTUP_MS = '120000';

/** An environment: process.env, or a plain object in tests. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Where one Maestro run goes: the device and, when the session passes its own, a driver port. */
export type MaestroDevice = {
  /** The simulator's UDID or the emulator's adb serial. */
  readonly id: string;
  readonly driverPort?: number | undefined;
};

/**
 * The major Java version of a JDK from its `release` file (JAVA_VERSION="17.0.12" -> 17), or null
 * when the file is missing or says nothing.
 */
export function javaMajorOf(home: string): number | null {
  const file = join(home, 'release');
  if (!existsSync(file)) return null;
  const version = /^JAVA_VERSION="(\d+)/m.exec(readFileSync(file, 'utf8'))?.[1];
  return version === undefined ? null : Number(version);
}

/**
 * JAVA_HOME for Java 17: the caller's unless its release file names another major (a CI image's
 * default JAVA_HOME is often 21), else java_home -v 17, else Android Studio's JDK.
 */
export function javaHome(env: Env): string {
  const given = env['JAVA_HOME'];
  if (given !== undefined && given !== '' && (javaMajorOf(given) ?? 17) === 17) return given;
  try {
    return execFileSync('/usr/libexec/java_home', ['-v', '17'], { encoding: 'utf8' }).trim();
  } catch {
    return ANDROID_STUDIO_JAVA;
  }
}

/** Java 17 and the quiet variables on top of `base`. */
export function maestroEnv(base: NodeJS.ProcessEnv, java: string): NodeJS.ProcessEnv {
  const startup: unknown = base['MAESTRO_DRIVER_STARTUP_TIMEOUT'];
  return {
    ...base,
    JAVA_HOME: java,
    ...MAESTRO_QUIET_ENV,
    // The driver's startup window (ms): a busy machine needs more than the default.
    MAESTRO_DRIVER_STARTUP_TIMEOUT: typeof startup === 'string' ? startup : DRIVER_STARTUP_MS,
  };
}

/**
 * One driver port per device for a whole run: the session's --driver-port, else a free port picked
 * once per device. A fresh port for every Maestro call on the same Android emulator left the next
 * call waiting for a driver that never started (seen 2026-10-14, Maestro 2.10.0).
 */
export function devicePorts(given: number | undefined): (deviceId: string) => Promise<number> {
  const ports = new Map<string, Promise<number>>();
  return (deviceId) => {
    if (given !== undefined) return Promise.resolve(given);
    const port = ports.get(deviceId) ?? freeDriverPort();
    ports.set(deviceId, port);
    return port;
  };
}

/** Runs the pinned installer; it exits at once when the pinned version is already installed. */
export function installMaestro(): void {
  execFileSync('bash', [INSTALL_MAESTRO], { stdio: 'inherit' });
}

/**
 * `<bin> --device <id> --driver-host-port <port> <args>`; returns Maestro's exit code. Each run takes
 * a free port unless the session passed one: the default port 7001 can belong to another session's
 * driver, which then answers this run.
 */
export async function runMaestro(
  bin: string,
  device: MaestroDevice,
  args: readonly string[],
): Promise<number> {
  const target = { udid: device.id, driverPort: device.driverPort ?? (await freeDriverPort()) };
  console.log(maestroRunLine(target, args));
  const env = maestroEnv(process.env, javaHome(process.env));
  return (
    spawnSync(bin, [...maestroGlobalArgs(target), ...args], { stdio: 'inherit', env }).status ?? 1
  );
}

/** The -e values every flow reads: the app's id and URL scheme (flows never set them in env:). */
export function appEnv(app: Pick<BuiltApp, 'id' | 'scheme'>): string[] {
  return ['-e', `APP_ID=${app.id}`, '-e', `APP_SCHEME=${app.scheme}`];
}

/** A JUnit report and the per-flow artefacts of one run, written into `dir`. */
export function reportArgs(dir: string): string[] {
  return ['--format', 'JUNIT', '--output', join(dir, 'junit.xml'), '--test-output-dir', dir];
}

/** One debug link applied to the running app through the setup sub-flow. */
export type DebugSetupRun = {
  readonly app: Pick<BuiltApp, 'id' | 'scheme'>;
  /** The debug link's query, for example 'lang=en&motion=still&open=tasks'. */
  readonly query: string;
  /** The testID that proves the link's target screen is shown. */
  readonly waitFor: string;
  readonly outDir: string;
};

/** `maestro test` arguments for one debug link; run them with runMaestro (device and port first). */
export function debugSetupArgs(run: DebugSetupRun): string[] {
  return [
    ...['test', DEBUG_SETUP_FLOW, '--test-output-dir', run.outDir],
    ...appEnv(run.app),
    ...['-e', `QUERY=${run.query}`, '-e', `WAIT_FOR=${run.waitFor}`],
  ];
}
