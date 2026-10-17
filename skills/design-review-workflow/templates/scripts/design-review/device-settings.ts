// scripts/design-review/device-settings.ts
// The device commands of a design-review sweep, as argument lists for the app's capture runner:
// appearance, text size, orientation, a clean status bar, upright screenshots, motion videos and
// Android's animation scales. Every command names its device (a simulator UDID, an emulator serial):
// several sessions share one machine, and "booted" or "the only device" can be someone else's. simctl
// has no switch for Reduce Motion or for rotation (Xcode 26.6): reduceMotionCommands() returns null on
// iOS (the reviewer flips it in the simulator's Settings app), and orientationCommands() returns null
// (the Maestro flow rotates with setOrientation: maestroOrientation(...)). Pure: the runner spawns the
// commands.

/** A simulator by UDID, or an emulator (or a USB device) by its adb serial. */
export type DeviceTarget =
  | { readonly platform: 'ios'; readonly udid: string }
  | { readonly platform: 'android'; readonly serial: string };

/** One command; `stdoutTo` means the runner writes the command's stdout to that file. */
export type DeviceCommand = { readonly argv: readonly string[]; readonly stdoutTo?: string };

export type Orientation = 'portrait' | 'landscape';

/**
 * A recording. Spawn `start` and keep the process. To stop: run `stop` when it is set (Android: an
 * interrupt to screenrecord on the device), else send SIGINT to the start process (iOS: simctl writes
 * the end of the movie). Then wait for the start process to exit, because the file is complete only
 * then (on Android the adb process exits once screenrecord has finished the MP4), and run `after`.
 */
export type VideoCommands = {
  readonly start: DeviceCommand;
  readonly stop: DeviceCommand | null;
  readonly after: readonly DeviceCommand[];
};

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SERIAL = /^(?:emulator-\d{4,5}|[A-Za-z0-9._-]+:\d+|[A-Za-z0-9]{6,})$/;
/** The longest single recording `screenrecord` makes. */
export const ANDROID_RECORD_LIMIT_S = 180;
const ANIMATION_SCALES = [
  'window_animation_scale',
  'transition_animation_scale',
  'animator_duration_scale',
];
const DEMO = ['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command'];

/** The device part of every command; throws on a missing, "booted" or "all" device. */
function head(target: DeviceTarget): readonly string[] {
  if (target.platform === 'ios') {
    if (!UDID.test(target.udid)) {
      throw new Error(`"${target.udid}" is not a simulator UDID (never booted, all or a name)`);
    }
    return ['xcrun', 'simctl'];
  }
  if (!SERIAL.test(target.serial)) {
    throw new Error(
      `"${target.serial}" is not an adb serial (emulator-5556, host:port, a device id)`,
    );
  }
  return ['adb', '-s', target.serial];
}

function simctl(
  target: Extract<DeviceTarget, { platform: 'ios' }>,
  ...args: string[]
): DeviceCommand {
  const [command = '', ...rest] = args;
  return { argv: [...head(target), command, target.udid, ...rest] };
}

function adb(
  target: Extract<DeviceTarget, { platform: 'android' }>,
  ...args: string[]
): DeviceCommand {
  return { argv: [...head(target), ...args] };
}

/** The system appearance the app's "system" theme follows. */
export function appearanceCommand(target: DeviceTarget, theme: 'light' | 'dark'): DeviceCommand {
  if (target.platform === 'ios') return simctl(target, 'ui', 'appearance', theme);
  return adb(target, 'shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no');
}

/** The text size: an iOS content-size category, an Android font_scale. */
export function textSizeCommand(
  target: DeviceTarget,
  size: { readonly ios?: string; readonly android?: number },
): DeviceCommand {
  if (target.platform === 'ios') {
    if (size.ios === undefined) throw new Error('this text size has no iOS content-size category');
    return simctl(target, 'ui', 'content_size', size.ios);
  }
  if (size.android === undefined) throw new Error('this text size has no Android font_scale');
  return adb(target, 'shell', 'settings', 'put', 'system', 'font_scale', String(size.android));
}

/** simctl status_bar override: 9:41 (the US style), full Wi-Fi and cell bars, no carrier, no bolt. */
const IOS_STATUS_BAR = [
  ['--time', '9:41'],
  ['--dataNetwork', 'wifi'],
  ['--wifiMode', 'active'],
  ['--wifiBars', '3'],
  ['--cellularMode', 'active'],
  ['--cellularBars', '4'],
  ['--operatorName', ''],
  ['--batteryState', 'discharging'],
  ['--batteryLevel', '100'],
].flat();

/** SystemUI demo mode commands: 09:41, full battery unplugged, full Wi-Fi, no notification icons. */
const ANDROID_DEMO = [
  ['enter'],
  ['clock', '-e', 'hhmm', '0941'],
  ['battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
  ['network', '-e', 'wifi', 'show', '-e', 'level', '4', '-e', 'mobile', 'hide'],
  ['notifications', '-e', 'visible', 'false'],
];

/** A status bar that differs only where the app differs: 9:41, full signal, full battery, no alerts. */
export function cleanStatusBarCommands(target: DeviceTarget): readonly DeviceCommand[] {
  if (target.platform === 'ios')
    return [simctl(target, 'status_bar', 'override', ...IOS_STATUS_BAR)];
  return [
    adb(target, 'shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'),
    ...ANDROID_DEMO.map((command) => adb(target, ...DEMO, ...command)),
  ];
}

/** Gives the status bar back after the sweep. */
export function resetStatusBarCommands(target: DeviceTarget): readonly DeviceCommand[] {
  if (target.platform === 'ios') return [simctl(target, 'status_bar', 'clear')];
  return [
    adb(target, ...DEMO, 'exit'),
    adb(target, 'shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '0'),
  ];
}

/**
 * The Maestro setOrientation value for the flow on iOS. Landscape is always LANDSCAPE_LEFT, because
 * screenshotCommands() turns that one upright (simctl writes the device's portrait frame buffer with
 * the landscape picture on its side).
 */
export function maestroOrientation(orientation: Orientation): 'PORTRAIT' | 'LANDSCAPE_LEFT' {
  return orientation === 'landscape' ? 'LANDSCAPE_LEFT' : 'PORTRAIT';
}

/**
 * Turns the device to `orientation`. Android: auto-rotate off, then user_rotation counted from the
 * device's natural orientation (phones are portrait; the medium_tablet and pixel_tablet AVD profiles
 * are landscape), so 0 is the natural one and 1 is a quarter turn. iOS: null, because simctl cannot
 * rotate a simulator; the flow runs setOrientation with maestroOrientation(orientation).
 */
export function orientationCommands(
  target: DeviceTarget,
  orientation: Orientation,
  natural: Orientation = 'portrait',
): readonly DeviceCommand[] | null {
  if (target.platform === 'ios') return null;
  const rotation = orientation === natural ? '0' : '1';
  return [
    adb(target, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'),
    adb(target, 'shell', 'settings', 'put', 'system', 'user_rotation', rotation),
  ];
}

/** Gives Android its natural orientation and auto-rotate back after the sweep; iOS: null. */
export function resetOrientationCommands(target: DeviceTarget): readonly DeviceCommand[] | null {
  if (target.platform === 'ios') return null;
  return [
    adb(target, 'shell', 'settings', 'put', 'system', 'user_rotation', '0'),
    adb(target, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1'),
  ];
}

/**
 * One upright PNG of the screen into `file`. Android's screencap follows the rotation. simctl writes
 * a rotated simulator's portrait frame buffer, so a landscape iOS capture (LANDSCAPE_LEFT) is turned a
 * quarter turn back with macOS's sips.
 */
export function screenshotCommands(
  target: DeviceTarget,
  file: string,
  orientation: Orientation = 'portrait',
): readonly DeviceCommand[] {
  if (target.platform === 'android') {
    return [{ ...adb(target, 'exec-out', 'screencap', '-p'), stdoutTo: file }];
  }
  const shot = simctl(target, 'io', 'screenshot', '--type=png', file);
  if (orientation === 'portrait') return [shot];
  return [shot, { argv: ['sips', '--rotate', '270', file] }];
}

/** A motion video into `file` (.mp4): H.264 on iOS; on Android recorded on the device, then pulled. */
export function recordVideoCommands(target: DeviceTarget, file: string): VideoCommands {
  if (target.platform === 'ios') {
    return {
      start: simctl(target, 'io', 'recordVideo', '--codec=h264', '--force', file),
      stop: null,
      after: [],
    };
  }
  const onDevice = '/sdcard/design-review-capture.mp4';
  return {
    start: adb(
      target,
      'shell',
      'screenrecord',
      '--time-limit',
      String(ANDROID_RECORD_LIMIT_S),
      onDevice,
    ),
    stop: adb(target, 'shell', 'pkill', '-INT', 'screenrecord'),
    after: [adb(target, 'pull', onDevice, file), adb(target, 'shell', 'rm', onDevice)],
  };
}

/**
 * Reduce motion on or off. Android: the three animation scales (React Native reads
 * transition_animation_scale, live). iOS: null, because simctl has no switch for it.
 */
export function reduceMotionCommands(
  target: DeviceTarget,
  isReduced: boolean,
): readonly DeviceCommand[] | null {
  if (target.platform === 'ios') return null;
  const value = isReduced ? '0' : '1';
  return ANIMATION_SCALES.map((key) =>
    adb(target, 'shell', 'settings', 'put', 'global', key, value),
  );
}
