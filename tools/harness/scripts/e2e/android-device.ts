// scripts/e2e/android-device.ts
// An Android emulator for E2E: the Android virtual device <prefix>-<purpose> (created once from the
// pinned system image), started by name on a console port of its own and then targeted only by its
// adb serial (emulator-<port>). Never a bare `adb shell`: with two devices attached it fails, and
// with one it may be another session's emulator.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { adbArgs } from '../android/adb-args.ts';

import type { E2eDevice, TextSize } from './e2e-device.ts';

/** Font scale per text size: 2.0 is the largest system setting on Android 14 and later. */
export const ANDROID_FONT_SCALE: Readonly<Record<TextSize, string>> = {
  default: '1.0',
  largest: '2.0',
};

const BOOT_POLL_MS = 2000;
const BOOT_MAX_POLLS = 150;
const DEMO = ['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command'];

/** Demo mode: a fixed 9:41 clock, full battery and signal, no notification icons. */
export function statusBarCommands(serial: string): string[][] {
  return [
    ['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'],
    [...DEMO, 'enter'],
    [...DEMO, 'clock', '-e', 'hhmm', '0941'],
    [...DEMO, 'battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
    [...DEMO, 'network', '-e', 'wifi', 'show', '-e', 'level', '4'],
    [...DEMO, 'notifications', '-e', 'visible', 'false'],
  ].map((args) => adbArgs(serial, ...args));
}

/** The three system animation scales: native stack transitions, ripples and system UI. */
export const ANIMATION_SCALES = [
  'window_animation_scale',
  'transition_animation_scale',
  'animator_duration_scale',
] as const;

/**
 * Every system animation off on this emulator: `motion=still` holds only the app's own animations,
 * while native transitions, ripples and system UI would still move in screenshots and while Maestro
 * waits. animator_duration_scale 0 also turns on React Native's reduce-motion signal, which matches
 * motion=still. The repo's own E2E emulator keeps this state, like demo mode; `1` restores it.
 */
export function stillAnimationCommands(serial: string, scale: '0' | '1' = '0'): string[][] {
  return ANIMATION_SCALES.map((name) =>
    adbArgs(serial, 'shell', 'settings', 'put', 'global', name, scale),
  );
}

/** The serial of a running emulator whose AVD is `name` (`adb -s <serial> emu avd name`), or null. */
export function serialOfAvd(
  devices: string,
  avdNameOf: (serial: string) => string,
  name: string,
): string | null {
  const serials = devices
    .split('\n')
    .map((line) => /^(emulator-\d+)\s+device$/.exec(line.trim())?.[1])
    .filter((serial) => serial !== undefined);
  return serials.find((serial) => avdNameOf(serial).split(/\r?\n/)[0]?.trim() === name) ?? null;
}

/** The Android SDK: ANDROID_HOME, ANDROID_SDK_ROOT, else the default macOS location. */
export function androidSdk(env: Readonly<Record<string, string | undefined>>): string {
  return (
    env['ANDROID_HOME'] ?? env['ANDROID_SDK_ROOT'] ?? join(homedir(), 'Library', 'Android', 'sdk')
  );
}

type Tools = { readonly adb: string; readonly emulator: string; readonly avdmanager: string };

function toolsOf(sdk: string): Tools {
  return {
    adb: join(sdk, 'platform-tools', 'adb'),
    emulator: join(sdk, 'emulator', 'emulator'),
    avdmanager: join(sdk, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
  };
}

const run = (tool: string, args: readonly string[]): string =>
  execFileSync(tool, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

/** Creates the AVD from the pinned system image the first time (answers "no custom profile"). */
function ensureAvd(tools: Tools, spec: AndroidSpec): void {
  if (run(tools.emulator, ['-list-avds']).split('\n').includes(spec.name)) return;
  if (!existsSync(tools.avdmanager))
    throw new Error(`avdmanager is missing in ${tools.avdmanager}`);
  execFileSync(
    tools.avdmanager,
    ['create', 'avd', '-n', spec.name, '-k', spec.image, '-d', spec.device],
    {
      input: 'no\n',
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

/** Starts the AVD on an even console port of its own and waits until Android has booted. */
async function startAvd(tools: Tools, name: string, port: number): Promise<string> {
  const args = [
    '-avd',
    name,
    '-port',
    String(port),
    '-no-snapshot-save',
    '-no-boot-anim',
    '-no-audio',
    '-no-window',
  ];
  spawn(tools.emulator, args, { detached: true, stdio: 'ignore' }).unref();
  const serial = `emulator-${String(port)}`;
  for (let poll = 0; poll < BOOT_MAX_POLLS; poll += 1) {
    await delay(BOOT_POLL_MS);
    try {
      if (run(tools.adb, adbArgs(serial, 'shell', 'getprop', 'sys.boot_completed')).trim() === '1')
        return serial;
    } catch {
      // adb does not see the emulator yet
    }
  }
  throw new Error(
    `${name} did not boot within ${String((BOOT_POLL_MS * BOOT_MAX_POLLS) / 1000)} s`,
  );
}

export type AndroidSpec = {
  /** The AVD name: <prefix>-<purpose>. */
  readonly name: string;
  /** The system image the AVD is created from (sdkmanager path). */
  readonly image: string;
  /** The hardware profile (avdmanager list device): pixel_8, pixel_tablet. */
  readonly device: string;
};

/** The first even console port from 5554 to 5682 that no attached emulator uses. */
export function freeConsolePort(devices: string): number {
  const used = new Set([...devices.matchAll(/emulator-(\d+)/g)].map((match) => Number(match[1])));
  for (let port = 5554; port <= 5682; port += 2) if (!used.has(port)) return port;
  throw new Error('every emulator console port from 5554 to 5682 is in use');
}

/** The repo's AVD `spec.name`, running, as an E2E device. */
export async function openAndroidDevice(spec: AndroidSpec): Promise<E2eDevice> {
  const tools = toolsOf(androidSdk(process.env));
  const adb = (serial: string, args: readonly string[]): string =>
    run(tools.adb, adbArgs(serial, ...args));
  ensureAvd(tools, spec);
  const devices = run(tools.adb, ['devices']);
  const running = serialOfAvd(devices, (serial) => adb(serial, ['emu', 'avd', 'name']), spec.name);
  const serial = running ?? (await startAvd(tools, spec.name, freeConsolePort(devices)));
  return {
    platform: 'android',
    name: spec.name,
    id: serial,
    install: (app) => adb(serial, ['install', '-r', app.path]),
    pinStatusBar: () => {
      for (const args of [...statusBarCommands(serial), ...stillAnimationCommands(serial)])
        run(tools.adb, args);
    },
    setTextSize: (size) =>
      adb(serial, ['shell', 'settings', 'put', 'system', 'font_scale', ANDROID_FONT_SCALE[size]]),
    setAppearance: (appearance) =>
      adb(serial, ['shell', 'cmd', 'uimode', 'night', appearance === 'dark' ? 'yes' : 'no']),
    terminate: (app) => adb(serial, ['shell', 'am', 'force-stop', app.id]),
  };
}
