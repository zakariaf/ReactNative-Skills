// scripts/e2e/maestro-args.ts
// The one way repo tooling points Maestro at a device. Every spawn of the Maestro binary starts with
// maestroGlobalArgs(...): the global --device <id> and --driver-host-port <port> BEFORE the command
// (test, hierarchy, ...). The per-command --udid alone and the default driver port 7001 let a run
// reach whichever driver already listens there (seen on a shared Mac: a hierarchy call answered from
// another session's simulator). The device is an iOS simulator's UDID or an Android device's adb
// serial (emulator-5554); Maestro 2.10 uses the driver port for both (the XCTest driver's host port
// on iOS, the adb forward's host port on Android). The e2e-maestro skill owns this file; build
// skills ship a copy for their --link step, and their setup checks (maestro-device) fail any other
// spawn.
import { createServer } from 'node:net';

/** Where one Maestro run goes: this device, and the host port of this run's own driver. */
export type MaestroTarget = {
  /**
   * The simulator's UDID from simctl, or the Android device's serial from adb (emulator-5554); never
   * "booted", a name or a comma-separated list.
   */
  readonly udid: string;
  /** freeDriverPort() for each run, or the port a session passes on purpose (--driver-port). */
  readonly driverPort: number;
};

/** A simulator UDID, a physical iPhone's UDID, an emulator serial, adb over TCP, or a USB serial. */
const DEVICE_IDS = [
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
  /^[0-9A-F]{8}-[0-9A-F]{16}$/i,
  /^emulator-\d{4,5}$/,
  /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/,
  /^(?=[A-Za-z]*\d)[A-Za-z0-9]{6,}$/,
];
const MIN_PORT = 1024;
const MAX_PORT = 65_535;

function assertUdid(udid: string): void {
  if (!DEVICE_IDS.some((pattern) => pattern.test(udid))) {
    throw new Error(
      `maestro: "${udid}" is not a simulator UDID or an adb serial; pass the id that ensureSimulator or adb returned, never a device name or a placeholder for the running one`,
    );
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `maestro: driver port ${String(port)} is not a port from ${String(MIN_PORT)} to ${String(MAX_PORT)}`,
    );
  }
}

/** The global arguments that go before the Maestro command: this device and this run's driver port. */
export function maestroGlobalArgs(target: MaestroTarget): string[] {
  assertUdid(target.udid);
  assertPort(target.driverPort);
  return ['--device', target.udid, '--driver-host-port', String(target.driverPort)];
}

/** A port nobody listens on right now: the system picks it (listen on port 0), then it is released. */
export function freeDriverPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        if (port === 0) reject(new Error('maestro: the system gave no free port'));
        else resolve(port);
      });
    });
  });
}

/** --driver-port <n> when a session passes its own port; otherwise a free port for this run. */
export async function driverPortFor(given: string | undefined): Promise<number> {
  if (given === undefined) return freeDriverPort();
  const port = Number(given);
  assertPort(port);
  return port;
}

/** One line for the run's log: which simulator and driver port a Maestro command went to. */
export function maestroRunLine(target: MaestroTarget, command: readonly string[]): string {
  const shown = command.slice(0, 2).join(' ');
  return `maestro: device ${target.udid}, driver port ${String(target.driverPort)}: ${shown}`;
}
