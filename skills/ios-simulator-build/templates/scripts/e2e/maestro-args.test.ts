// scripts/e2e/maestro-args.test.ts
import { createServer } from 'node:net';

import {
  driverPortFor,
  freeDriverPort,
  maestroGlobalArgs,
  maestroRunLine,
} from './maestro-args.ts';

const UDID = '0C9E3F8A-51D2-4B7E-9A61-2F4D8C7B1E03';

function listenOn(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => {
        resolve();
      });
    });
  });
}

describe('maestroGlobalArgs', () => {
  it('names the device and the driver port, to go before the command', () => {
    const args = [...maestroGlobalArgs({ udid: UDID, driverPort: 53_117 }), 'test', 'flow.yaml'];
    expect(args).toStrictEqual([
      '--device',
      UDID,
      '--driver-host-port',
      '53117',
      'test',
      'flow.yaml',
    ]);
  });

  it('names an Android device by its adb serial', () => {
    for (const serial of ['emulator-5554', 'R58M12345AB', '192.168.1.20:5555']) {
      expect(maestroGlobalArgs({ udid: serial, driverPort: 53_117 }).slice(0, 2)).toStrictEqual([
        '--device',
        serial,
      ]);
    }
  });

  it('refuses the word booted, a device name and a list of devices', () => {
    for (const udid of ['booted', 'tasks-e2e', 'emulator', `${UDID},${UDID}`, '']) {
      expect(() => maestroGlobalArgs({ udid, driverPort: 53_117 })).toThrow(
        'is not a simulator UDID',
      );
    }
  });

  it('refuses a port outside 1024-65535', () => {
    for (const driverPort of [0, 80, 65_536, 7001.5]) {
      expect(() => maestroGlobalArgs({ udid: UDID, driverPort })).toThrow('is not a port');
    }
  });
});

describe('freeDriverPort', () => {
  it('returns a port nobody listens on, which the run can then use', async () => {
    const port = await freeDriverPort();
    expect(port).toBeGreaterThanOrEqual(1024);
    await expect(listenOn(port)).resolves.toBeUndefined();
  });
});

describe('driverPortFor', () => {
  it("keeps a session's own port", async () => {
    await expect(driverPortFor('61234')).resolves.toBe(61_234);
  });

  it('refuses a port that is not a number', async () => {
    await expect(driverPortFor('seven')).rejects.toThrow('is not a port');
  });

  it('picks a free port when none is given', async () => {
    await expect(driverPortFor(undefined)).resolves.toBeGreaterThanOrEqual(1024);
  });
});

describe('maestroRunLine', () => {
  it('logs the device and port of the run with its command', () => {
    expect(
      maestroRunLine({ udid: UDID, driverPort: 53_117 }, ['test', 'a.yaml', '--format', 'JUNIT']),
    ).toBe(`maestro: device ${UDID}, driver port 53117: test a.yaml`);
  });
});
