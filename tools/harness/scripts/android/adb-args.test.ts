// scripts/android/adb-args.test.ts
import { adbArgs, assertSerial } from './adb-args.ts';

describe('adbArgs', () => {
  it('puts -s <serial> before the command', () => {
    expect(adbArgs('emulator-5556', 'shell', 'getprop', 'sys.boot_completed')).toStrictEqual([
      '-s',
      'emulator-5556',
      'shell',
      'getprop',
      'sys.boot_completed',
    ]);
  });

  it('accepts USB and network serials', () => {
    expect(() => {
      assertSerial('R58M123ABC');
      assertSerial('192.168.1.20:5555');
    }).not.toThrow();
  });

  it('refuses an option or an empty serial', () => {
    expect(() => adbArgs('-e', 'install')).toThrow('is not an adb serial');
    expect(() => adbArgs('', 'install')).toThrow('is not an adb serial');
  });
});
