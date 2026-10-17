// scripts/ios/simulators.test.ts
import {
  deleteOwnSimulator,
  ensureSimulator,
  findSimulator,
  installAndLaunch,
  shutdownOwnSimulator,
  simulatorName,
  simulatorPrefixOf,
  statusBarArgs,
  type SimctlDeviceList,
} from './simulators.ts';
import { IOS_RUNTIME } from './toolchain.ts';

const SMOKE = '0C9E3F8A-51D2-4B7E-9A61-2F4D8C7B1E03';
const OTHER = '7D1B2C3E-4F50-4A6B-8C7D-9E0F1A2B3C4D';
const CREATED = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';

const LIST: SimctlDeviceList = {
  devices: {
    [IOS_RUNTIME]: [
      { name: 'tasks-e2e', udid: OTHER, state: 'Booted', isAvailable: true },
      { name: 'tasks-smoke', udid: SMOKE, state: 'Shutdown', isAvailable: true },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-6': [
      { name: 'tasks-smoke', udid: 'OLD', state: 'Shutdown', isAvailable: true },
    ],
  },
};

const SPEC = { name: 'tasks-smoke', deviceType: 'iPhone 17 Pro Max', runtime: IOS_RUNTIME };

function recorder(answer: (args: readonly string[]) => string): {
  readonly calls: string[][];
  readonly simctl: (args: readonly string[]) => string;
} {
  const calls: string[][] = [];
  return {
    calls,
    simctl: (args) => {
      calls.push([...args]);
      return answer(args);
    },
  };
}

describe('simulatorName', () => {
  it('joins the prefix and the purpose', () => {
    expect(simulatorName('tasks', 'smoke')).toBe('tasks-smoke');
  });

  it('rejects a part that is not kebab-case', () => {
    expect(() => simulatorName('tasks', 'My Phone')).toThrow('must be kebab-case');
  });

  it('derives the prefix from the package name', () => {
    expect([simulatorPrefixOf('@acme/Tasks_App'), simulatorPrefixOf('tasks')]).toStrictEqual([
      'tasks-app',
      'tasks',
    ]);
    expect(() => simulatorPrefixOf('@acme/')).toThrow('cannot derive a simulator prefix');
  });
});

describe('findSimulator', () => {
  it('finds the device by name on the pinned runtime only', () => {
    expect(findSimulator(LIST, 'tasks-smoke', IOS_RUNTIME)?.udid).toBe(SMOKE);
  });

  it('returns undefined for an unknown name', () => {
    expect(findSimulator(LIST, 'tasks-parity', IOS_RUNTIME)).toBeUndefined();
  });
});

describe('ensureSimulator', () => {
  it('reuses an existing simulator without creating one', () => {
    const { calls, simctl } = recorder(() => JSON.stringify(LIST));
    expect(ensureSimulator(simctl, SPEC)).toBe(SMOKE);
    expect(calls).toStrictEqual([['list', 'devices', '--json']]);
  });

  it('creates, warms up and shuts down a missing simulator', () => {
    const { calls, simctl } = recorder((args) =>
      args[0] === 'list' ? JSON.stringify(LIST) : `${CREATED}\n`,
    );
    expect(ensureSimulator(simctl, { ...SPEC, name: 'tasks-parity' })).toBe(CREATED);
    expect(calls[1]).toStrictEqual(['create', 'tasks-parity', 'iPhone 17 Pro Max', IOS_RUNTIME]);
    expect(calls.every((args) => !args.includes('booted') && !args.includes('all'))).toBe(true);
    expect(calls.at(-1)).toStrictEqual(['shutdown', CREATED]);
  });

  it('refuses an answer that is not a UDID', () => {
    const { simctl } = recorder((args) => (args[0] === 'list' ? JSON.stringify(LIST) : 'oops'));
    expect(() => ensureSimulator(simctl, { ...SPEC, name: 'tasks-parity' })).toThrow(
      'is not a simulator UDID',
    );
  });
});

describe('statusBarArgs', () => {
  it('pins the time to 9:41 for the given device', () => {
    expect(statusBarArgs(SMOKE).slice(0, 5)).toStrictEqual([
      'status_bar',
      SMOKE,
      'override',
      '--time',
      '9:41',
    ]);
    expect(() => statusBarArgs('booted')).toThrow('is not a simulator UDID');
  });
});

describe('installAndLaunch', () => {
  it('installs on the UDID and cold-starts the bundle', () => {
    const { calls, simctl } = recorder(() => '');
    installAndLaunch(simctl, SMOKE, { path: 'build/Tasks.app', bundleId: 'com.acme.tasks' });
    expect(calls).toStrictEqual([
      ['install', SMOKE, 'build/Tasks.app'],
      ['launch', '--terminate-running-process', SMOKE, 'com.acme.tasks'],
    ]);
  });
});

describe('own simulators', () => {
  it('shuts down and deletes only simulators with the prefix', () => {
    const { calls, simctl } = recorder(() => '');
    const own = { name: 'tasks-smoke', udid: SMOKE, state: 'Booted' };
    shutdownOwnSimulator(simctl, own, 'tasks');
    deleteOwnSimulator(simctl, own, 'tasks');
    expect(calls).toStrictEqual([
      ['shutdown', SMOKE],
      ['delete', SMOKE],
    ]);
  });

  it('refuses a simulator another session created', () => {
    const foreign = { name: 'iPhone 17 Pro Max', udid: OTHER, state: 'Booted' };
    expect(() => {
      deleteOwnSimulator(() => '', foreign, 'tasks');
    }).toThrow('refusing to delete');
    expect(() => {
      shutdownOwnSimulator(() => '', foreign, 'tasks');
    }).toThrow('refusing to shut down');
  });
});
