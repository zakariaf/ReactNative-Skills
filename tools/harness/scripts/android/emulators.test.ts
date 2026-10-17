// scripts/android/emulators.test.ts
import {
  assertAvdBehind,
  avdName,
  avdNameFromConsole,
  avdPrefixOf,
  consoleSerial,
  crashReportOf,
  createAvdArgs,
  emulatorArgs,
  findRunningAvd,
  installFresh,
  isBootCompleted,
  launchApp,
  launcherComponentOf,
  pickConsolePort,
  prepareForScreenshots,
  resumedPackageOf,
  stopOwnEmulator,
  usedConsolePorts,
  type Adb,
} from './emulators.ts';

const DEVICES =
  'List of devices attached\nemulator-5554\tdevice\nemulator-5558\toffline\nR58M1\tdevice\n\n';
const PKG = 'com.acme.tasks.preview';

function recorder(answer: (args: readonly string[]) => string): {
  readonly calls: string[][];
  readonly adb: Adb;
} {
  const calls: string[][] = [];
  return {
    calls,
    adb: (args) => {
      calls.push([...args]);
      return answer(args);
    },
  };
}

function consoles(names: Readonly<Record<string, string>>): (args: readonly string[]) => string {
  return (args) => {
    if (args[0] === 'devices') return DEVICES;
    const name = names[args[1] ?? ''];
    return args.includes('avd') && name !== undefined ? `${name}\r\nOK\r\n` : '';
  };
}

describe('names', () => {
  it('derives the prefix from the package name and joins the purpose', () => {
    expect(avdPrefixOf('@acme/Tasks_App')).toBe('tasks-app');
    expect(avdName('tasks', 'smoke')).toBe('tasks-smoke');
  });

  it('rejects a part that is not kebab-case', () => {
    expect(() => avdName('tasks', 'Pixel 8')).toThrow('must be kebab-case');
  });
});

describe('console ports', () => {
  it('reads the emulator ports adb lists, of any state', () => {
    expect([...usedConsolePorts(DEVICES)]).toStrictEqual([5554, 5558]);
  });

  it('picks the first free even port and names its serial', () => {
    expect(consoleSerial(pickConsolePort(usedConsolePorts(DEVICES)))).toBe('emulator-5556');
  });

  it('throws when all sixteen ports are taken', () => {
    const all = new Set(Array.from({ length: 16 }, (_, index) => 5554 + index * 2));
    expect(() => pickConsolePort(all)).toThrow('every emulator console port');
  });
});

describe('parsers', () => {
  it('reads the AVD name from the console answer', () => {
    expect(avdNameFromConsole('tasks-smoke\r\nOK\r\n')).toBe('tasks-smoke');
    expect(avdNameFromConsole('OK\r\n')).toBeNull();
  });

  it('reads boot completion, the launcher and the resumed package', () => {
    expect([isBootCompleted('1\n'), isBootCompleted('\n')]).toStrictEqual([true, false]);
    expect(launcherComponentOf(`priority=0\n${PKG}/.MainActivity\n`, PKG)).toBe(
      `${PKG}/.MainActivity`,
    );
    expect(() => launcherComponentOf('No activity found\n', PKG)).toThrow('no launcher activity');
    const dumpsys = `  topResumedActivity=ActivityRecord{1a2b u0 ${PKG}/.MainActivity t12}\n`;
    expect(resumedPackageOf(dumpsys)).toBe(PKG);
    expect(resumedPackageOf('  ResumedActivity: none\n')).toBeNull();
  });

  it('finds the crash report of the package only', () => {
    const report = `--------- beginning of crash\nE AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: ${PKG}, PID: 4242\n`;
    expect(crashReportOf(report, PKG)).toContain('FATAL EXCEPTION');
    expect(crashReportOf(report, 'com.acme.other')).toBeNull();
  });
});

describe('arguments', () => {
  it('creates the AVD on the pinned image and profile', () => {
    const spec = {
      name: 'tasks-smoke',
      systemImage: 'system-images;android-36;google_apis;arm64-v8a',
      device: 'pixel_8',
    };
    expect(createAvdArgs(spec)).toStrictEqual([
      'create',
      'avd',
      '--name',
      'tasks-smoke',
      '--package',
      spec.systemImage,
      '--device',
      'pixel_8',
    ]);
  });

  it('starts the emulator by AVD name on the chosen port, headless', () => {
    expect(emulatorArgs('tasks-smoke', 5556).slice(0, 4)).toStrictEqual([
      '-avd',
      'tasks-smoke',
      '-port',
      '5556',
    ]);
    expect(emulatorArgs('tasks-smoke', 5556)).toContain('-no-window');
  });
});

describe('device calls', () => {
  it('finds a running AVD by asking each console its name', () => {
    const { adb } = recorder(
      consoles({ 'emulator-5554': 'other-e2e', 'emulator-5558': 'tasks-smoke' }),
    );
    expect(findRunningAvd(adb, 'tasks-smoke')).toBe('emulator-5558');
    expect(findRunningAvd(adb, 'tasks-e2e')).toBeNull();
  });

  it('refuses a serial that runs another AVD', () => {
    const { adb } = recorder(consoles({ 'emulator-5554': 'other-e2e' }));
    expect(() => {
      assertAvdBehind(adb, 'emulator-5554', 'tasks-smoke');
    }).toThrow('refusing to use it');
  });

  it('names the serial in every call it makes', () => {
    const { adb, calls } = recorder((args) =>
      args.includes('resolve-activity') ? `${PKG}/.MainActivity` : '',
    );
    prepareForScreenshots(adb, 'emulator-5556');
    installFresh(adb, 'emulator-5556', { apk: 'app-release.apk', packageName: PKG });
    launchApp(adb, 'emulator-5556', PKG);
    expect(calls.every((call) => call[0] === '-s' && call[1] === 'emulator-5556')).toBe(true);
    expect(calls.at(-1)).toStrictEqual([
      '-s',
      'emulator-5556',
      'shell',
      'am',
      'start',
      '-S',
      '-W',
      '-n',
      `${PKG}/.MainActivity`,
    ]);
  });

  it('installs even when the uninstall finds nothing', () => {
    const { adb, calls } = recorder((args) => {
      if (args.includes('uninstall')) throw new Error('Unknown package');
      return 'Success';
    });
    installFresh(adb, 'emulator-5556', { apk: 'app-release.apk', packageName: PKG });
    expect(calls.at(-1)).toStrictEqual(['-s', 'emulator-5556', 'install', 'app-release.apk']);
  });

  it('stops only an emulator of this repo', () => {
    const own = recorder(consoles({ 'emulator-5558': 'tasks-smoke' }));
    stopOwnEmulator(own.adb, 'emulator-5558', 'tasks');
    expect(own.calls.at(-1)).toStrictEqual(['-s', 'emulator-5558', 'emu', 'kill']);
    const other = recorder(consoles({ 'emulator-5554': 'other-e2e' }));
    expect(() => {
      stopOwnEmulator(other.adb, 'emulator-5554', 'tasks');
    }).toThrow('not a tasks-* emulator');
  });
});
