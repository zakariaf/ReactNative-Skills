// scripts/e2e/android-device.test.ts
import {
  ANDROID_FONT_SCALE,
  androidSdk,
  freeConsolePort,
  serialOfAvd,
  statusBarCommands,
  stillAnimationCommands,
} from './android-device.ts';

const DEVICES =
  'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\nR58M123\tdevice\n';

describe('adb binding', () => {
  // adbArgs itself is android-emulator-build's (scripts/android/adb-args.ts, with its own tests);
  // here: every command this module builds goes through it.
  it('puts -s <serial> before every command it builds', () => {
    const all = [...statusBarCommands('emulator-5554'), ...stillAnimationCommands('emulator-5554')];
    expect(all.every((args) => args[0] === '-s' && args[1] === 'emulator-5554')).toBe(true);
  });

  it('refuses an empty serial or an adb device flag as the serial', () => {
    expect(() => statusBarCommands('')).toThrow('is not an adb serial');
    expect(() => stillAnimationCommands('-e')).toThrow('is not an adb serial');
  });
});

describe('statusBarCommands', () => {
  it('pins the clock to 9:41 on this emulator only', () => {
    const commands = statusBarCommands('emulator-5556');
    expect(commands.every((args) => args[0] === '-s' && args[1] === 'emulator-5556')).toBe(true);
    expect(commands.some((args) => args.includes('0941'))).toBe(true);
  });
});

describe('stillAnimationCommands', () => {
  it('turns the three system animation scales off on this emulator only', () => {
    const commands = stillAnimationCommands('emulator-5556');
    const prefix = ['-s', 'emulator-5556', 'shell', 'settings', 'put', 'global'];
    expect(commands.every((args) => prefix.every((part, index) => args[index] === part))).toBe(
      true,
    );
    expect(commands.map((args) => args.slice(prefix.length))).toStrictEqual([
      ['window_animation_scale', '0'],
      ['transition_animation_scale', '0'],
      ['animator_duration_scale', '0'],
    ]);
  });

  it('restores them with 1', () => {
    expect(stillAnimationCommands('emulator-5556', '1').every((args) => args.at(-1) === '1')).toBe(
      true,
    );
  });
});

describe('serialOfAvd', () => {
  it('finds the running emulator of one AVD by asking each emulator its name', () => {
    const names: Record<string, string> = {
      'emulator-5554': 'someone-else\r\nOK',
      'emulator-5556': 'tasks-e2e-phone\r\nOK',
    };
    expect(serialOfAvd(DEVICES, (serial) => names[serial] ?? '', 'tasks-e2e-phone')).toBe(
      'emulator-5556',
    );
    expect(serialOfAvd(DEVICES, (serial) => names[serial] ?? '', 'tasks-e2e-tablet')).toBeNull();
  });
});

describe('freeConsolePort', () => {
  it('skips the ports attached emulators use', () => {
    expect(freeConsolePort(DEVICES)).toBe(5558);
    expect(freeConsolePort('List of devices attached\n')).toBe(5554);
  });
});

describe('androidSdk', () => {
  it('prefers ANDROID_HOME, then ANDROID_SDK_ROOT', () => {
    expect(androidSdk({ ANDROID_HOME: '/sdk', ANDROID_SDK_ROOT: '/other' })).toBe('/sdk');
    expect(androidSdk({ ANDROID_SDK_ROOT: '/other' })).toBe('/other');
  });
});

describe('ANDROID_FONT_SCALE', () => {
  it('uses the largest font scale for the large-text step', () => {
    expect(ANDROID_FONT_SCALE.largest).toBe('2.0');
  });
});
