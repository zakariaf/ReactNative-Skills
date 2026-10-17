// scripts/design-review/device-settings.test.ts
import {
  ANDROID_RECORD_LIMIT_S,
  appearanceCommand,
  cleanStatusBarCommands,
  maestroOrientation,
  orientationCommands,
  recordVideoCommands,
  reduceMotionCommands,
  resetOrientationCommands,
  resetStatusBarCommands,
  screenshotCommands,
  textSizeCommand,
  type DeviceTarget,
} from './device-settings.ts';

const UDID = '6F1A2B3C-4D5E-4F60-8A9B-0C1D2E3F4A5B';
const IPHONE: DeviceTarget = { platform: 'ios', udid: UDID };
const ANDROID: DeviceTarget = { platform: 'android', serial: 'emulator-5556' };

describe('device targets', () => {
  it('refuses a device that is not named', () => {
    expect(() => appearanceCommand({ platform: 'ios', udid: 'booted' }, 'dark')).toThrow(
      'not a simulator UDID',
    );
    expect(() => appearanceCommand({ platform: 'android', serial: '' }, 'dark')).toThrow(
      'not an adb serial',
    );
  });

  it('puts the device before the command on both platforms', () => {
    expect(appearanceCommand(IPHONE, 'dark').argv).toStrictEqual([
      'xcrun',
      'simctl',
      'ui',
      UDID,
      'appearance',
      'dark',
    ]);
    expect(appearanceCommand(ANDROID, 'light').argv).toStrictEqual([
      'adb',
      '-s',
      'emulator-5556',
      'shell',
      'cmd',
      'uimode',
      'night',
      'no',
    ]);
  });
});

describe('text size, status bar and motion', () => {
  it('sets the iOS content-size category and the Android font scale', () => {
    const largest = { ios: 'accessibility-extra-extra-extra-large', android: 2 };
    expect(textSizeCommand(IPHONE, largest).argv.slice(-2)).toStrictEqual([
      'content_size',
      'accessibility-extra-extra-extra-large',
    ]);
    expect(textSizeCommand(ANDROID, largest).argv.slice(-3)).toStrictEqual([
      'system',
      'font_scale',
      '2',
    ]);
    expect(() => textSizeCommand(ANDROID, { ios: 'large' })).toThrow('no Android font_scale');
  });

  it('pins the status bar and gives it back', () => {
    expect(cleanStatusBarCommands(IPHONE)[0]?.argv).toContain('9:41');
    expect(cleanStatusBarCommands(ANDROID).map((c) => c.argv.at(-1))).toContain('false');
    expect(resetStatusBarCommands(IPHONE)[0]?.argv.slice(2)).toStrictEqual([
      'status_bar',
      UDID,
      'clear',
    ]);
    expect(resetStatusBarCommands(ANDROID)).toHaveLength(2);
  });

  it('reduces motion through the three Android animation scales; iOS has no simctl switch', () => {
    const commands = reduceMotionCommands(ANDROID, true) ?? [];
    expect(commands.map((c) => c.argv.slice(-2))).toStrictEqual([
      ['window_animation_scale', '0'],
      ['transition_animation_scale', '0'],
      ['animator_duration_scale', '0'],
    ]);
    expect(reduceMotionCommands(IPHONE, true)).toBeNull();
  });
});

describe('orientation', () => {
  it('rotates Android from its natural orientation with auto-rotate off', () => {
    const phone = orientationCommands(ANDROID, 'landscape') ?? [];
    expect(phone.map((c) => c.argv.slice(-2))).toStrictEqual([
      ['accelerometer_rotation', '0'],
      ['user_rotation', '1'],
    ]);
    const tablet = orientationCommands(ANDROID, 'landscape', 'landscape') ?? [];
    expect(tablet.at(-1)?.argv.at(-1)).toBe('0');
    expect(resetOrientationCommands(ANDROID)?.at(-1)?.argv.slice(-2)).toStrictEqual([
      'accelerometer_rotation',
      '1',
    ]);
  });

  it('leaves iOS rotation to the Maestro flow, always landscape left', () => {
    expect(orientationCommands(IPHONE, 'landscape')).toBeNull();
    expect(resetOrientationCommands(IPHONE)).toBeNull();
    expect(maestroOrientation('landscape')).toBe('LANDSCAPE_LEFT');
    expect(maestroOrientation('portrait')).toBe('PORTRAIT');
  });
});

describe('captures', () => {
  it('writes a PNG from simctl, and from screencap through stdout', () => {
    expect(screenshotCommands(IPHONE, 'a.png').map((c) => c.argv.slice(-2))).toStrictEqual([
      ['--type=png', 'a.png'],
    ]);
    expect(screenshotCommands(ANDROID, 'a.png', 'landscape')).toStrictEqual([
      { argv: ['adb', '-s', 'emulator-5556', 'exec-out', 'screencap', '-p'], stdoutTo: 'a.png' },
    ]);
  });

  it('turns a landscape simulator capture upright', () => {
    const commands = screenshotCommands(IPHONE, 'a.png', 'landscape');
    expect(commands.at(-1)?.argv).toStrictEqual(['sips', '--rotate', '270', 'a.png']);
  });

  it('records H.264 on iOS and stops Android on the device before pulling', () => {
    const ios = recordVideoCommands(IPHONE, 'm.mp4');
    expect(ios.start.argv).toContain('--codec=h264');
    expect(ios.stop).toBeNull();
    const android = recordVideoCommands(ANDROID, 'm.mp4');
    expect(android.start.argv).toContain(String(ANDROID_RECORD_LIMIT_S));
    expect(android.stop?.argv.slice(3)).toStrictEqual(['shell', 'pkill', '-INT', 'screenrecord']);
    expect(android.after.map((c) => c.argv[3])).toStrictEqual(['pull', 'shell']);
  });
});
