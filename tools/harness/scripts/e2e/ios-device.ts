// scripts/e2e/ios-device.ts
// An iOS simulator for E2E: <prefix>-<purpose> on the pinned runtime (ios-simulator-build's
// simulators.ts creates it once), booted and then targeted only by its UDID. Never "booted" or
// "all": another session's simulator may be the booted one. Xcode is the pinned one (DEVELOPER_DIR).
import { createSimctl, ensureSimulator, simulatorName, statusBarArgs } from '../ios/simulators.ts';
import { IOS_RUNTIME, selectXcode } from '../ios/toolchain.ts';

import type { E2eDevice, TextSize } from './e2e-device.ts';
import type { Simctl } from '../ios/simulators.ts';

/** Dynamic Type sizes: large is the system default; AX5 is about 3.6x in React Native's font scale. */
export const IOS_CONTENT_SIZE: Readonly<Record<TextSize, string>> = {
  default: 'large',
  largest: 'accessibility-extra-extra-extra-large',
};

/** What to do when simctl cannot boot another simulator (other sessions' simulators fill the Mac). */
export function bootFailureMessage(name: string, errorText: string): string | null {
  if (!/insufficient system resources|maxUserProcs/i.test(errorText)) return null;
  return [
    `simctl could not boot ${name}: the Mac has no room for another simulator.`,
    "Shut down this session's own simulators by UDID (xcrun simctl shutdown <udid>), never another",
    "session's, or reuse one of yours with --sim <purpose>, then run again.",
  ].join(' ');
}

function errorText(error: unknown): string {
  const stderr = (error as { readonly stderr?: unknown }).stderr;
  const detail = typeof stderr === 'string' || Buffer.isBuffer(stderr) ? stderr.toString() : '';
  return `${error instanceof Error ? error.message : String(error)} ${detail}`;
}

/** Boots the simulator if needed and waits until it is ready. */
function boot(simctl: Simctl, udid: string, name: string): void {
  try {
    simctl(['bootstatus', udid, '-b']);
  } catch (error: unknown) {
    const message = bootFailureMessage(name, errorText(error));
    if (message === null) throw error;
    throw new Error(message, { cause: error });
  }
}

/** The repo's simulator <prefix>-<purpose> of `model`, booted, as an E2E device. */
export function openIosDevice(spec: {
  readonly prefix: string;
  readonly purpose: string;
  readonly model: string;
}): E2eDevice {
  const simctl = createSimctl(selectXcode(process.env));
  const name = simulatorName(spec.prefix, spec.purpose);
  const udid = ensureSimulator(simctl, { name, deviceType: spec.model, runtime: IOS_RUNTIME });
  boot(simctl, udid, name);
  return {
    platform: 'ios',
    name,
    id: udid,
    install: (app) => {
      simctl(['install', udid, app.path]);
    },
    pinStatusBar: () => {
      simctl(statusBarArgs(udid));
    },
    setTextSize: (size) => {
      simctl(['ui', udid, 'content_size', IOS_CONTENT_SIZE[size]]);
    },
    setAppearance: (appearance) => {
      simctl(['ui', udid, 'appearance', appearance]);
    },
    terminate: (app) => {
      try {
        simctl(['terminate', udid, app.id]);
      } catch {
        // not running
      }
    },
  };
}
